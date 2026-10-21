/*
 * Test data to be used in tests
 */

const { randomUUID: uuid } = require('node:crypto')

const goodSubmission = {
  topic: 'submission.notification.create',
  originator: 'submission-api',
  timestamp: '2018-02-03T00:00:00',
  'mime-type': 'application/json',
  payload: {
    submissionId: uuid(),
    url: 'https://drive.google.com/file/d/1l7KPjqzHtF9dA94cMjJ4a32yRvPEQIg4/view?usp=sharing',
    fileName: 'good.zip',
    status: 'unscanned'
  }
}

const infectedSubmission = {
  topic: 'submission.notification.create',
  originator: 'submission-api',
  timestamp: '2018-02-03T00:00:00',
  'mime-type': 'application/json',
  payload: {
    submissionId: uuid(),
    url: 'https://www.dropbox.com/s/31idvhiz9l7v35k/EICAR_submission.zip?dl=1',
    fileName: 'infected.zip',
    status: 'unscanned'
  }
}

const s3Submission = {
  topic: 'submission.notification.create',
  originator: 'submission-api',
  timestamp: '2018-02-03T00:00:00',
  'mime-type': 'application/json',
  payload: {
    submissionId: uuid(),
    url: 'https://s3.amazonaws.com/topcoder-dev-submissions-tests/good_submission.zip',
    fileName: 's3.zip',
    status: 'unscanned'
  }
}

module.exports = {
  goodSubmission,
  infectedSubmission,
  s3Submission
}
