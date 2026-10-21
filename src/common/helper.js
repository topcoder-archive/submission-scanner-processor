/**
 * Contains generic helper methods
 */

const config = require('config')
const clamav = require('clamav.js')
const logger = require('./logger')
const request = require('axios').default
const m2mAuth = require('tc-core-library-js').auth.m2m
const { S3Client, HeadObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const m2m = m2mAuth(config)
const AmazonS3URI = require('amazon-s3-uri')
const pure = require('@ronomon/pure')
const { WEBHOOK_AUTH_METHODS } = require('./constants')

const s3 = new S3Client({ region: config.get('aws.REGION') })

// Initialize ClamAV
const CLAMAV_VERSION_TIMEOUT = 500
const CLAMAV_RETRY_DELAY = 5000
const CLAMAV_SCANNER_WAIT_TIMEOUT = 15000
let clamavScanner = null
let clamavScannerInitialization = null
let activeScans = 0
const scanQueue = []

/**
 * Sleep helper used while waiting for ClamAV to become available.
 * @param {Number} delayInMs wait time in milliseconds
 * @returns {Promise<void>} resolves after delay
 */
function wait (delayInMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayInMs)
  })
}

/**
 * Reserve a ClamAV scan slot so large file scans do not run without bounds.
 * @returns {Promise<Function>} resolves with a release callback for the scan slot
 */
function acquireScanSlot () {
  return new Promise((resolve) => {
    const grantSlot = () => {
      activeScans += 1
      resolve(releaseScanSlot)
    }

    if (activeScans < config.SCAN_CONCURRENCY) {
      grantSlot()
    } else {
      logger.info(`ClamAV scan queued. activeScans=${activeScans}, queuedScans=${scanQueue.length + 1}`)
      scanQueue.push(grantSlot)
    }
  })
}

/**
 * Release a ClamAV scan slot and wake the next queued scan, if any.
 * @returns {void}
 */
function releaseScanSlot () {
  activeScans = Math.max(0, activeScans - 1)
  const nextScan = scanQueue.shift()
  if (nextScan) {
    nextScan()
  }
}

/**
 * Destroy a stream when an in-flight scan fails before consuming the full body.
 * @param {Object} stream readable stream to destroy
 * @returns {void}
 */
function destroyStream (stream) {
  if (stream && typeof stream.destroy === 'function' && !stream.destroyed) {
    stream.destroy()
  }
}

/**
 * Get ClamAV engine/version status.
 * @returns {Promise<String>} clamd version status text
 * @throws {Error} when clamd is unreachable or times out
 */
function getClamAvVersion () {
  return new Promise((resolve, reject) => {
    clamav.version(
      config.CLAMAV_PORT,
      config.CLAMAV_HOST,
      CLAMAV_VERSION_TIMEOUT,
      (error, status) => {
        if (error) {
          reject(error)
        } else {
          resolve(status)
        }
      }
    )
  })
}

/**
 * Ensure there is an initialized scanner instance before any scans are run.
 * This is used both at startup and by scan requests to avoid a null scanner race.
 * @param {Number} maxWaitInMs maximum wait time in milliseconds (0 = no timeout)
 * @returns {Promise<Object>} scanner returned by clamav.js createScanner
 * @throws {Error} when scanner could not be initialized in time
 */
async function ensureClamAvScanner (maxWaitInMs = 0) {
  if (clamavScanner) {
    return clamavScanner
  }

  if (!clamavScannerInitialization) {
    clamavScannerInitialization = (async () => {
      while (!clamavScanner) {
        logger.info('Checking ClamAV Status.')
        try {
          const status = await getClamAvVersion()
          logger.info('ClamAV connection established.', status)
          clamavScanner = clamav.createScanner(
            config.CLAMAV_PORT,
            config.CLAMAV_HOST
          )
        } catch (error) {
          logger.info(`ClamAV not live yet. ${JSON.stringify(error)}`)
          await wait(CLAMAV_RETRY_DELAY)
        }
      }

      return clamavScanner
    })().finally(() => {
      clamavScannerInitialization = null
    })
  }

  if (maxWaitInMs > 0) {
    return Promise.race([
      clamavScannerInitialization,
      wait(maxWaitInMs).then(() => {
        throw new Error(`Timed out waiting for ClamAV scanner initialization after ${maxWaitInMs}ms`)
      })
    ])
  }

  return clamavScannerInitialization
}

ensureClamAvScanner().catch((error) => {
  logger.error('Unexpected scanner initialization failure', error)
})

/**
 * Get S3 metadata for a file without downloading the object body.
 * @param {String} bucket Bucket of the file to inspect
 * @param {String} key Key of the file to inspect
 * @returns {Promise<Object>} object metadata including contentLength in bytes
 * @throws {Error} when the object metadata cannot be read from S3
 */
async function getFileMetadata (bucket, key) {
  logger.info(`getFileMetadata(): file is on S3 ${bucket} / ${key}`)
  const fileMetadata = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  return {
    contentLength: fileMetadata.ContentLength
  }
}

/**
 * Get a readable S3 stream for a file without buffering it in memory.
 * @param {String} bucket Bucket of the file to stream
 * @param {String} key Key of the file to stream
 * @returns {Promise<Object>} readable stream of the S3 object body
 * @throws {Error} when the object body cannot be opened from S3
 */
async function getFileStream (bucket, key) {
  logger.info(`getFileStream(): file is on S3 ${bucket} / ${key}`)
  const downloadedFile = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!downloadedFile.Body) {
    throw new Error(`S3 object ${bucket}/${key} did not include a readable body`)
  }
  return downloadedFile.Body
}

/**
 * Convert a readable stream into a Buffer for legacy callers that require it.
 * @param {Object} stream readable stream to consume
 * @returns {Promise<Buffer>} buffer containing the full stream contents
 * @throws {Error} when the stream cannot be read
 */
async function streamToBuffer (stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Function to download file from given URL
 * @param {String} bucket Bucket of the file to be downloaded
 * @param {String} key Key of the file to be downloaded
 * @returns {Promise<Buffer>} Buffer of downloaded file
 */
async function downloadFile (bucket, key) {
  logger.info(`downloadFile(): file is on S3 ${bucket} / ${key}`)
  return streamToBuffer(await getFileStream(bucket, key))
}

function parseAndValidateUrl (fileUrl) {
  try {
    const { region, bucket, key } = new AmazonS3URI(fileUrl)
    return { region, bucket, key }
  } catch (err) {
    throw new Error(`${fileUrl} is not a valid S3 uri`)
  }
}

/**
 * check if the file is a zipbomb
 *
 * @param {string} fileBuffer the file buffer
 * @returns
 */
function isZipBomb (fileBuffer) {
  logger.info('Checking if file is a ZipBomb')
  try {
    const error = pure.zip(fileBuffer, 0)

    // we only care about zip bombs
    if (error.code === 'PURE_E_OK' || error.code.indexOf('ZIP_BOMB') === -1) {
      return [false]
    } else {
      return [true, error.code, error.message]
    }
  } catch (err) {
    throw new Error('Error occurred while testing file to see if it is a ZipBomb')
  }
}

/**
 * Determine whether a ClamAV error was caused by exceeding the stream size limit.
 * @param {Error} error ClamAV scan error
 * @returns {Boolean} true when the error is a ClamAV size-limit failure
 */
function isClamAvSizeLimitError (error) {
  return Boolean(error && error.message && /INSTREAM size limit exceeded|Size limit reached/i.test(error.message))
}

/**
 * Scan a readable file stream through clamd and return infection status.
 * @param {Object} fileStream readable stream of file contents
 * @returns {Promise<Boolean>} true if infected, false when clean
 * @throws {Error} when ClamAV is unavailable or scan fails
 */
async function scanWithClamAV (fileStream) {
  logger.info('Scanning file with ClamAV')
  const releaseScanSlot = await acquireScanSlot()

  try {
    const scanner = await ensureClamAvScanner(CLAMAV_SCANNER_WAIT_TIMEOUT)

    try {
      const status = await getClamAvVersion()
      logger.info('ClamAV is up and running.', status)
    } catch (error) {
      logger.error('Unable to communicate with ClamAV')
      throw error
    }

    return await new Promise((resolve, reject) => {
      try {
        scanner.scan(fileStream, (scanErr, object, malicious) => {
          if (scanErr) {
            logger.info('Scan Error')
            destroyStream(fileStream)
            reject(scanErr)
            return
          }
          if (malicious == null) {
            logger.info('File is clean')
            resolve(false)
          } else {
            logger.warn(`Infection detected ${malicious}`)
            resolve(true)
          }
        })
      } catch (error) {
        logger.error(error)
        destroyStream(fileStream)
        reject(error)
      }
    })
  } finally {
    releaseScanSlot()
  }
}

/** Obtain a cached or newly verified Keycloak token for Bus publishing.
 * Takes no arguments and uses explicit KEYCLOAK_* configuration.
 * @returns {Promise<string>} RS256 service token verified by shared core.
 * @throws {Error} Sanitized shared-core errors on issuance/validation failure.
 */
async function getM2Mtoken () {
  return m2m.getMachineToken()
}

/**
 * Function to POST to Bus API
 * @param{Object} reqBody Body of the request to be Posted
 * @returns {Promise}
 */
async function postToBusAPI (reqBody) {
  // M2M token necessary for pushing to Bus API
  const token = await getM2Mtoken()
  // Post the request body to Bus API
  return request.post(config.BUSAPI_EVENTS_URL, reqBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
}

/**
 * Move file from one AWS S3 bucket to another bucket.
 * @param {String} sourceBucket the source bucket
 * @param {String} sourceKey the source key
 * @param {String} targetBucket the target bucket
 * @param {String} targetKey the target key
 */
async function moveFile (sourceBucket, sourceKey, targetBucket, targetKey) {
  await s3.send(new CopyObjectCommand({ Bucket: targetBucket, CopySource: `${sourceBucket}/${sourceKey}`, Key: targetKey }))
  await s3.send(new DeleteObjectCommand({ Bucket: sourceBucket, Key: sourceKey }))
}

/**
 * Function to POST to Callback URL
 * @param{Object} message Body of the request to be Posted
 * @returns {Promise}
 */
async function postToCallbackURL (webHookOptions, data) {
  const { url, method, auth, secret } = webHookOptions
  const reqBody = {
    method,
    url,
    headers: {
      'Content-Type': 'application/json'
    },
    data
  }
  if (auth === WEBHOOK_AUTH_METHODS.BEARER) {
    reqBody.headers.Authorization = `Bearer ${secret}`
  } else if (auth === WEBHOOK_AUTH_METHODS.BASIC) {
    reqBody.headers.Authorization = `Basic ${secret}`
  } else if (auth === WEBHOOK_AUTH_METHODS.API_KEY) {
    reqBody.headers['X-API-Key'] = secret
  }
  return request(reqBody)
}

/**
 * Post alert to Opsgenie
 * @param {String} message the message
 * @param {String} source the source
 * @param {String} priority the priority
 */
async function postAlertToOpsgenie (message, source, priority) {
  logger.info('Posting alert to Opsgenie')
  // print details
  logger.info(`message: ${message}`)
  logger.info(`source: ${source}`)
  logger.info(`priority: ${priority}`)
  try {
    request.post(config.OPSGENIE_API_URL, { message, source, priority }, {
      headers: {
        Authorization: `GenieKey ${config.OPSGENIE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
  } catch (err) {
    logger.error(err)
  }
}

module.exports = {
  isZipBomb,
  isClamAvSizeLimitError,
  getFileMetadata,
  getFileStream,
  scanWithClamAV,
  postToBusAPI,
  downloadFile,
  parseAndValidateUrl,
  moveFile,
  postToCallbackURL,
  postAlertToOpsgenie
}
