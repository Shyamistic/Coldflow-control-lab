import { createApp } from './app.mjs'
const server = createApp().listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log(`ColdFlow simulation listening on port ${process.env.PORT || 8080}`))
process.on('SIGTERM', () => server.close(() => process.exit(0)))