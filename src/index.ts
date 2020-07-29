import { Application } from 'probot' // eslint-disable-line no-unused-vars
import { request } from '@octokit/request'
import * as url from 'url'
import * as fs from 'fs'

const textAnalyticsKey = process.env['TEXT_ANALYTICS_KEY'] || ''
const textAnalyticsEndPoint = process.env['TEXT_ANALYTICS_ENDPOINT'] || ''

const keywordLibraryUsed = 'Library used:'
const keywordArtifactId = '<artifactId>'

const mapArtifactId2Label = new Map<string, string>([
  ['azure-core', 'azure-core'],
  ['azure-resourcemanager-resources', 'mgmt-resources'],
  ['azure-resourcemanager-storage', 'mgmt-storage'],
  ['azure-resourcemanager-compute', 'mgmt-compute'],
  ['azure-resourcemanager-network', 'mgmt-network']
])

export = (app: Application) => {
  app.on('issues', async (context) => {
    if (context.payload.action == 'opened') {
      const issueComment = context.issue({ body: 'Thanks for opening this issue!' })
      await context.github.issues.createComment(issueComment)
    }

    if (context.payload.action == 'opened' || (context.payload.action == 'edited')) {
      const labels = []

      // by title
      if (context.payload.issue.title.toLowerCase().includes('[feature request]')) {
        labels.push('feature-request')
      } else if (context.payload.issue.title.toLowerCase().includes('[bug]')) {
        labels.push('bug')
      }

      // by artifact id
      const bodyLines = context.payload.issue.body.split('\n', 256)
      for (const line of bodyLines) {
        let sdkName = undefined
        // library used
        if (line.includes(keywordLibraryUsed)) {
          const pos = line.lastIndexOf(keywordLibraryUsed) + keywordLibraryUsed.length
          const subline = line.substring(pos).trim()
          let nextPos = subline.indexOf(' ')
          if (nextPos == -1) {
            nextPos = subline.length
          }
          sdkName = subline.substring(0, nextPos).trim()
        }
        // artifact id
        if (!sdkName && line.includes(keywordArtifactId)) {
          const pos = line.lastIndexOf(keywordLibraryUsed) + keywordLibraryUsed.length
          let nextPos = line.indexOf('</artifactId>', pos)
          if (nextPos == -1) {
            nextPos = line.length
          }
          sdkName = line.substring(pos, nextPos).trim()
        }

        if (sdkName) {
          const label = mapArtifactId2Label.get(sdkName)
          if (label && !labels.includes(label)) {
            labels.push(label)

            app.log(`add label "${label}" via artifact id`)

            if (label.startsWith('mgmt-')) {
              labels.push('mgmt')
            }
          }
        }
      }

      if (context.payload.action == 'opened') {
        // by key phrases
        if (context.payload.issue.body.length > 100 && context.payload.issue.body.length < 5120) {
          const keyPhrases = await getKeyPhrases(context.payload.issue.body)
          app.log(`key phrases found in issue body: ${keyPhrases}`)

          if (keyPhrases.length > 0) {
            for (const phrase of keyPhrases) {
              const phraseLower = phrase.toLowerCase()
              let label
              if (phraseLower.includes('fluent') || phraseLower.includes('manager') || phraseLower.includes('management')) {
                label = 'mgmt'
              }

              if (label && !labels.includes(label)) {
                labels.push(label)

                app.log(`add label "${label}" via key phrase "${phrase}"`)  
              }
            }
          }
        }
      }

      if (labels.length > 0) {
        const issueAddLabels = context.issue({ labels: labels })
        await context.github.issues.addLabels(issueAddLabels)
      }

      if (context.payload.action == 'opened') {
        if (context.payload.issue.title.toLowerCase().includes('[query]')) {
          const queryInTitle = context.payload.issue.title.substr(context.payload.issue.title.toLowerCase().indexOf('[query]') + '[query]'.length)
          const keyPhrases = await getKeyPhrases(queryInTitle)
          app.log(`key phrases found in query title: ${keyPhrases}`)

          if (keyPhrases.length > 0) {
            const sampleInfos = getSamples()
            const matchedSampleInfos = []
            for (const sampleInfo of sampleInfos) {
              const description = sampleInfo.getDescription().toLowerCase()
              for (const phrase of keyPhrases) {
                if (description.includes(phrase.toLowerCase())) {
                  matchedSampleInfos.push(sampleInfo)
                  app.log(`found sample "${sampleInfo.getDescription()}" via key phrase "${phrase}"`)  
                  break
                }
              }
            }

            if (matchedSampleInfos.length > 0) {
              let sampleRecommend = 'Here are code samples that might help:'
              for (const sampleInfo of matchedSampleInfos) {
                sampleRecommend += '\n'
                sampleRecommend += '[' + sampleInfo.getDescription() + ']'
                sampleRecommend += '(' + sampleInfo.getUrl() + ')'
              }

              const issueComment = context.issue({ body: sampleRecommend })
              await context.github.issues.createComment(issueComment)        
            }
          }
        }
      }
    }
  })
}

async function getKeyPhrases(text: string): Promise<string[]> {
  let keyPhrases: string[] = []

  const response = await request({
    method: 'POST',
    url: url.resolve(textAnalyticsEndPoint, '/text/analytics/v2.1/keyPhrases'),
    headers: {
      'Ocp-Apim-Subscription-Key': textAnalyticsKey,
    },
    mediaType: {
      format: 'json'
    },

    documents: [
      {
        'language': 'en',
        'id': Date.now().toString(),
        'text': text
      }
    ]
  })
  
  if (response.status == 200) {
    keyPhrases = response.data.documents[0].keyPhrases
  }

  return keyPhrases
}

class SampleInfo {
  private url: string
  private description: string

  constructor(url: string, description: string) {
    this.url = url;
    this.description = description
  }

  public getUrl(): string {
    return this.url
  }

  public getDescription(): string {
    return this.description
  }
}

let sampleInfos: SampleInfo[]

function getSamples(): SampleInfo[] {
  if (!sampleInfos) {
    const samplesJson = fs.readFileSync('samples.json', 'utf8')
    const samples = JSON.parse(samplesJson)
    const sampleInfos1: SampleInfo[] = []
    for (const item of samples.javaSamples) {
      const sampleUrl = url.resolve('https://github.com/Azure/azure-sdk-for-java/tree/master/sdk/management/', item.filePath)
      const sampleInfo = new SampleInfo(sampleUrl, item.description)
      sampleInfos1.push(sampleInfo)
    }
    sampleInfos = sampleInfos1
  }
  return sampleInfos
}
