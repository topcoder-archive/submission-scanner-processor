# Topcoder - File Scanner Processor

## Dependencies

- nodejs https://nodejs.org/en/ (22.23.2)
- Kafka
- Docker, Docker Compose (Only for deployment with Docker)

## Configuration

Configuration of the Submission Scanner Processor is at `config/default.js`.
The following parameters can be set in config files or in env variables:

- LOG_LEVEL: the log level; default value: 'debug'
- KAFKA_URL: comma separated Kafka hosts; default value: 'localhost:9092'
- KAFKA_CLIENT_CERT: Kafka connection certificate, optional; default value is undefined;
    if not provided, then SSL connection is not used, direct insecure connection is used;
    if provided, it can be either path to certificate file or certificate content
- KAFKA_CLIENT_CERT_KEY: Kafka connection private key, optional; default value is undefined;
    if not provided, then SSL connection is not used, direct insecure connection is used;
    if provided, it can be either path to private key file or private key content
- KAFKA_GROUP_ID: the Kafka group id, default value is 'submission-scanner-processor'
- AVSCAN_TOPIC: Topic for AV Scan related actions, default value is 'avscan.action.scan'
- CLAMAV_HOST: Host of Clam AV
- CLAMAV_PORT: Port of Clam AV
- MAX_SCAN_FILE_SIZE_BYTES: Maximum S3 object size accepted for scanning; default value is 524288000 (500 MiB).
- SCAN_CONCURRENCY: Maximum number of concurrent ClamAV scans in one processor task; default value is 1.
- BUSAPI_EVENTS_URL: Bus API Events URL
- AWS_REGION: AWS Region of S3 bucket if there is a need to read files from S3 bucket

Also note that there is a `/health` endpoint that checks process liveness only. It intentionally does not fail on transient Kafka broker connection state because this service is a Kafka worker and ECS should not recycle the task during Kafka rebalances or short broker reconnects. This sets up an expressjs server and listens on the environment variable `PORT`. It's not part of the configuration file and needs to be passed as an environment variable.

## Scan limits and failure behavior

Before scanning, the processor reads S3 object metadata and compares `ContentLength` to `MAX_SCAN_FILE_SIZE_BYTES`. If the object is too large, the processor does not download it. The result payload is marked with `status: "scan-failed"`, `isInfected: true`, `scanError: "file-size-exceeded"`, and `scanErrorMessage`, then normal result handling runs. When `moveFile` is true, this routes the file to the quarantine bucket.

The same fail-closed result is used if ClamAV rejects an in-flight stream with an INSTREAM size-limit error. Other unexpected processing errors are logged and the Kafka offset is not committed, allowing the message to be retried.

S3 files are streamed into ClamAV instead of buffered into memory. Use `SCAN_CONCURRENCY` to control how many scans can run inside one ECS task at the same time. Keep this value conservative because ClamAV memory usage increases with large files, archive expansion, and signature database reloads.

## Local Kafka setup

- `http://kafka.apache.org/quickstart` contains details to setup and manage Kafka server,
  below provides details to setup Kafka server in Mac, Windows will use bat commands in bin/windows instead
- download kafka at `https://www.apache.org/dyn/closer.cgi?path=/kafka/1.1.0/kafka_2.11-1.1.0.tgz`
- extract out the downloaded tgz file
- go to the extracted directory kafka_2.11-0.11.0.1
- start ZooKeeper server:
  `bin/zookeeper-server-start.sh config/zookeeper.properties`
- use another terminal, go to same directory, start the Kafka server:
  `bin/kafka-server-start.sh config/server.properties`
- note that the zookeeper server is at localhost:2181, and Kafka server is at localhost:9092
- use another terminal, go to same directory, create some topics:
```
  bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic avscan.action.scan
```
- verify that the topics are created:
  `bin/kafka-topics.sh --list --zookeeper localhost:2181`,
  it should list out the created topics
- run the producer and then write some message into the console to send to the topic `avscan.action.scan`:
  `bin/kafka-console-producer.sh --broker-list localhost:9092 --topic avscan.action.scan`
- In the console, write some message, one message per line:
E.g.
```
{"topic":"avscan.action.scan","originator":"av-scanner-service","timestamp":"2018-09-19T12:12:28.434Z","mime-type":"application/json","payload":{"status":"unscanned","submissionId":"a12a4180-65aa-42ec-a945-5fd21dec0503","url":"https://drive.google.com/file/d/16kkvI-itLYaH8IuVDrLsRL94t-HK1w19/view?usp=sharing","fileName":"a12a4180-65aa-42ec-a945-5fd21dec0503.zip"}}
```
- optionally, use another terminal, go to same directory, start a consumer to view the messages:
```
  bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic avscan.action.scan --from-beginning
```

## Local deployment

1. From the project root directory, run the following command to install the dependencies

```
npm i
```

2. To run linters if required

```
npm run lint

npm run lint:fix # To fix possible lint errors
```

3. Set the environment variables as necessary. Refer to `config/default.js`

4. Start the processor

```
npm start
```

## Local Deployment with Docker

To run the Submission Scoring Processor using docker, follow the below steps

1. Navigate to the directory `docker`

2. Rename the file `sample.api.env` to `api.env`

3. Set the required credentials in the file `api.env`

4. Once that is done, run the following command

```
docker-compose up
```

5. When you are running the application for the first time, It will take some time initially to download the image and install the dependencies


## Verification

1. Ensure that Bus API and Clam AV is up and running

2. Set the required environment variables

3. Ensure that Kafka is up and running and the topic `avscan.action.scan` is created in Kafka

4. Attach to the topic `avscan.action.scan` using Kafka console producer

```
bin/kafka-console-producer.sh --broker-list localhost:9092 --topic avscan.action.scan
```

5. Write the following message to the Console

```
{"topic":"avscan.action.scan","originator":"av-scanner-service","timestamp":"2018-09-19T12:15:05.821Z","mime-type":"application/json","payload":{"status":"unscanned","submissionId":"a12a4180-65aa-42ec-a945-5fd21dec0502","url":"https://www.dropbox.com/s/31idvhiz9l7v35k/EICAR_submission.zip?dl=1","fileName":"a12a4180-65aa-42ec-a945-5fd21dec0502.zip"}}
```

6. File in the above URL is an infected submission, hence the following message will be posted to Bus API

```
{"topic":"avscan.action.scan","originator":"av-scanner-service","timestamp":"2018-09-19T12:15:05.821Z","mime-type":"application/json","payload":{"status":"scanned","submissionId":"a12a4180-65aa-42ec-a945-5fd21dec0502","url":"https://www.dropbox.com/s/31idvhiz9l7v35k/EICAR_submission.zip?dl=1","fileName":"a12a4180-65aa-42ec-a945-5fd21dec0502.zip","isInfected":true}}
```

7. Write the following message to the Console

```
{"topic":"avscan.action.scan","originator":"av-scanner-service","timestamp":"2018-09-19T12:12:28.434Z","mime-type":"application/json","payload":{"status":"unscanned","submissionId":"a12a4180-65aa-42ec-a945-5fd21dec0503","url":"https://drive.google.com/file/d/16kkvI-itLYaH8IuVDrLsRL94t-HK1w19/view?usp=sharing","fileName":"a12a4180-65aa-42ec-a945-5fd21dec0503.zip"}}
```


8. File in the above URL is a clean submission, hence the following message will be posted to Bus API

```
{"topic":"avscan.action.scan","originator":"av-scanner-service","timestamp":"2018-09-19T12:12:28.434Z","mime-type":"application/json","payload":{"status":"scanned","submissionId":"a12a4180-65aa-42ec-a945-5fd21dec0503","url":"https://drive.google.com/file/d/16kkvI-itLYaH8IuVDrLsRL94t-HK1w19/view?usp=sharing","fileName":"a12a4180-65aa-42ec-a945-5fd21dec0503.zip","isInfected":false}}
```

Token Commit.

## Keycloak migration branch

`keycloak_m2M` pins shared core 4.0.0-keycloak.0 at
`c262f4aca971904f308085bdeaaed35cdf3cfa7d`. Configure `M2M_PROVIDER=keycloak`,
`KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_TOKEN_URL`,
`KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, and optionally `KEYCLOAK_SCOPE`.
Use the HTTPS managed endpoint and grant `write:bus_api`. See
`docker/sample.api.env`. A persistent shared-core provider verifies all issued
RS256 tokens before Bus transport and owns cache expiry; Auth0 proxy fallback
and unverified token caching are removed. Webhook credentials remain independent.

`yarn lint`, `yarn run build` (JavaScript syntax validation), and
`yarn test:keycloak` exercise the migration without external writes. The legacy
scanner suite additionally needs ClamAV, file fixtures and S3 access. Supply the
new dedicated settings before any future deployment; CI excludes this branch
and existing DEV services are not deployed by this change.

Validation evidence: lint/build and signed-token transport tests pass, including
live DEV issuance with mocked Bus transport. The legacy scanner suite has three
failures because its fixtures omit `message.payload.moveFile`; the same failures
reproduce on unchanged commit `81dd53d3` with its Node 18.16.1 runtime and
independently installed dependencies. Its original lockfile is out of sync with
package.json (frozen install fails); baseline installation required resolution.
The migration replaces the fixture's undeclared `uuid/v4` dependency with Node's
`randomUUID` so the suite can reach those existing fixture validation failures.
