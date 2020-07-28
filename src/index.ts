import { Application } from 'probot' // eslint-disable-line no-unused-vars
import { request } from '@octokit/request'
import * as url from 'url'

export = (app: Application) => {
  app.on('issues', async (context) => {
    if (context.payload.action == 'opened') {
      const issueComment = context.issue({ body: 'Thanks for opening this issue!' })
      await context.github.issues.createComment(issueComment)
    }

    if (context.payload.action == 'opened' || (context.payload.action == 'edited')) {
      const labels: string[] = []
      if (context.payload.issue.title.toLowerCase().includes('[feature request]')) {
        labels.push('feature-request')
      } else if (context.payload.issue.title.toLowerCase().includes('[bug]')) {
        labels.push('bug')
      }

      if (context.payload.issue.body.length > 100 && context.payload.issue.body.length < 5120) {
        const textAnalyticsKey = process.env['TEXT_ANALYTICS_KEY'] || ''
        const textAnalyticsEndPoint = process.env['TEXT_ANALYTICS_ENDPOINT'] || ''

        const response = await request('POST ' + url.resolve(textAnalyticsEndPoint, '/text/analytics/v2.0/keyPhrases'), {
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
              'text': context.payload.issue.body
            }
          ]
        })
        app.log(response)
      }

      if (labels.length > 0) {
        const issueAddLabels = context.issue({ labels: labels })
        await context.github.issues.addLabels(issueAddLabels)
      }
    }
  })
}
