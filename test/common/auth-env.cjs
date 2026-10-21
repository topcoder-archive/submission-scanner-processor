// Synthetic offline settings for legacy scanner tests; never load deployment credentials.
Object.assign(process.env, {
  M2M_PROVIDER: 'keycloak', KEYCLOAK_ISSUER: 'https://scanner.test/realms/m2m',
  KEYCLOAK_AUDIENCE: 'https://api.test', KEYCLOAK_TOKEN_URL: 'https://scanner.test/m2m/token',
  KEYCLOAK_CLIENT_ID: 'scanner-test', KEYCLOAK_CLIENT_SECRET: 'synthetic-secret'
})
