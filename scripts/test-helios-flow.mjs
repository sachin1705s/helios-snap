import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const appPath = path.join(projectRoot, 'src', 'App.jsx')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const source = await readFile(appPath, 'utf8')

  assert(source.includes('@reactor-team/js-sdk'), 'App is not importing the Reactor JS SDK.')
  assert(source.includes('ReactorProvider'), 'App is not using ReactorProvider.')
  assert(source.includes('useReactorMessage'), 'App is not listening for model messages.')
  assert(source.includes('useStats'), 'App is not reading Reactor connection stats.')
  assert(
    source.includes('connectOptions={{ autoConnect: true }}'),
    'ReactorProvider is not auto-connecting.'
  )
  assert(
    source.includes("modelName=\"helios\""),
    'App is not targeting the Helios model.'
  )
  assert(
    source.includes("const envApiKey = import.meta.env.VITE_REACTOR_API_KEY || ''"),
    'App is not using the env Reactor API key.'
  )
  assert(
    source.includes("fetch(`${REACTOR_API_URL}/tokens`"),
    'Frontend token fetching is missing.'
  )
  assert(
    source.includes("'Reactor-API-Key': apiKey"),
    'Token fetch is not sending the Reactor API key header.'
  )
  assert(
    source.includes('uploadFile'),
    'Helios flow is not using the SDK uploadFile API.'
  )
  assert(
    source.includes("const preparedBlob = snapshot.blob"),
    'Helios flow is not keeping the original snapshot blob for upload.'
  )
  assert(
    source.includes("const imageRef = await uploadFile(preparedBlob, {"),
    'Helios flow is not uploading the original image before set_image.'
  )
  assert(
    source.includes("await sendCommand('set_image', { image: imageRef, transition: 'cut' })"),
    'Helios flow is not using the FileRef set_image command.'
  )
  assert(
    source.includes("await waitForModelEvent((event) => event?.event === 'image_set')"),
    'Helios flow is not waiting for the image_set confirmation.'
  )
  assert(
    source.includes("await sendCommand('schedule_prompt', { prompt: prompt.trim(), chunk: 0 })"),
    'Helios flow is not scheduling the prompt at chunk 0.'
  )
  assert(
    source.includes("await sendCommand('start', {})"),
    'Helios start command is missing.'
  )
  assert(
    source.includes("await sendCommand('pause', {})"),
    'Pause control is missing.'
  )
  assert(
    source.includes("await sendCommand('resume', {})"),
    'Resume control is missing.'
  )
  assert(
    source.includes("await sendCommand('reset', {})"),
    'Reset control is missing.'
  )
  assert(
    !source.includes('image_b64'),
    'Found the old image_b64 path; the app should stay on the new FileUpload path.'
  )
  assert(
    !source.includes('prepareSnapshotForUpload'),
    'Found the old preprocessing path; the new FileUpload system should use the raw image blob.'
  )
  console.log('Helios rebuild checks passed.')
}

main().catch((error) => {
  console.error(`Helios rebuild test failed: ${error.message}`)
  process.exitCode = 1
})
