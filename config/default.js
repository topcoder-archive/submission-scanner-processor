/**
 * The default configuration file.
 */

/**
 * Parse a positive integer config value and fall back when it is absent or invalid.
 * @param {String|Number} value raw environment/config value
 * @param {Number} defaultValue value to use when the raw value is not a positive integer
 * @returns {Number} parsed positive integer
 */
function parsePositiveInteger (value, defaultValue) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue
}

const DEFAULT_MAX_SCAN_FILE_SIZE_BYTES = 500 * 1024 * 1024
const DEFAULT_SCAN_CONCURRENCY = 1

module.exports = {
  DISABLE_LOGGING: process.env.DISABLE_LOGGING || false, // If true, logging will be disabled
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',

  KAFKA_URL: process.env.KAFKA_URL || 'localhost:9092',
  // below are used for secure Kafka connection, they are optional
  // for the local Kafka, they are not needed
  KAFKA_CLIENT_CERT: process.env.KAFKA_CLIENT_CERT ? process.env.KAFKA_CLIENT_CERT.replace(/\\n/g, '\n') : null,
  KAFKA_CLIENT_CERT_KEY: process.env.KAFKA_CLIENT_CERT_KEY ? process.env.KAFKA_CLIENT_CERT_KEY.replace(/\\n/g, '\n') : null,

  // Kafka group id
  KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID || 'file-scanner-processor',
  KAFKA_ORIGINATOR: process.env.KAFKA_ORIGINATOR || 'file-scanner-processor',

  aws: {
    REGION: process.env.AWS_REGION || 'us-east-1' // AWS Region to be used by the application
  },

  AVSCAN_TOPIC: process.env.AVSCAN_TOPIC || 'avscan.action.scan',
  CLAMAV_HOST: process.env.CLAMAV_HOST || 'filescanner',
  CLAMAV_PORT: process.env.CLAMAV_PORT || 3310,
  MAX_SCAN_FILE_SIZE_BYTES: parsePositiveInteger(process.env.MAX_SCAN_FILE_SIZE_BYTES, DEFAULT_MAX_SCAN_FILE_SIZE_BYTES),
  SCAN_CONCURRENCY: parsePositiveInteger(process.env.SCAN_CONCURRENCY, DEFAULT_SCAN_CONCURRENCY),
  BUSAPI_EVENTS_URL: process.env.BUSAPI_EVENTS_URL || 'https://api.topcoder-dev.com/v5/bus/events',
  // Explicit Keycloak provider configuration; no Auth0 issuance fallback.
  M2M_PROVIDER: process.env.M2M_PROVIDER,
  KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER,
  KEYCLOAK_AUDIENCE: process.env.KEYCLOAK_AUDIENCE,
  KEYCLOAK_TOKEN_URL: process.env.KEYCLOAK_TOKEN_URL,
  KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET: process.env.KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_SCOPE: process.env.KEYCLOAK_SCOPE,

  // Whitelisted buckets and topics
  WHITELISTED_CLEAN_BUCKETS: process.env.WHITELISTED_CLEAN_BUCKETS ? process.env.WHITELISTED_CLEAN_BUCKETS.split(',') : [],
  WHITELISTED_QUARANTINE_BUCKETS: process.env.WHITELISTED_QUARANTINE_BUCKETS ? process.env.WHITELISTED_QUARANTINE_BUCKETS.split(',') : [],
  WHITELISTED_KAFKA_TOPICS: process.env.WHITELISTED_KAFKA_TOPICS ? process.env.WHITELISTED_KAFKA_TOPICS.split(',') : [],

  OPSGENIE_API_URL: process.env.OPSGENIE_API_URL || 'https://api.opsgenie.com/v2/alerts',
  OPSGENIE_API_KEY: process.env.OPSGENIE_API_KEY,
  OPSGENIE_SOURCE: process.env.OPSGENIE_SOURCE || 'DevOps',
  OPGENIE_ENABLED: process.env.OPGENIE_ENABLED === 'true' || false
}
