import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import YAML from "yaml"

type StorageRow = {
  filesystem: string
  sizeKb: number
  usedKb: number
  availableKb: number
  capacity: number
  mount: string
}

type StorageResponse = {
  host: string
  checkedAt: string
  targetPath: string
  rows: StorageRow[]
}

type HomerConfig = {
  services?: Array<{
    name?: string
    items?: Array<{
      name?: string
      subtitle?: string
      logo?: string
      url?: string
    }>
  }>
}

type AppStatus = {
  name: string
  subtitle: string
  logo?: string
  url: string
  status: "online" | "offline"
  statusCode?: number
  latencyMs?: number
  error?: string
}

type AppGroup = {
  name: string
  items: AppStatus[]
}

type HermesStatus = {
  status: "online" | "offline"
  gatewayState: string | null
  activeAgents: number
  connectedPlatforms: number
  totalPlatforms: number
  pid: number | null
  version: string | null
  updatedAt: string | null
  checkedAt: string
  error?: string
}

const port = Number(Bun.env.PORT ?? 3001)
const storagePath = Bun.env.STORAGE_PATH ?? "/"
const homerConfigUrl = Bun.env.HOMER_CONFIG_URL
const homerConfigPath = Bun.env.HOMER_CONFIG_PATH
const appCheckBase = Bun.env.APP_CHECK_BASE
const publicLanHost = Bun.env.PUBLIC_LAN_HOST
const publicTailscaleHost = Bun.env.PUBLIC_TAILSCALE_HOST
const workoutAppUrl = Bun.env.WORKOUT_APP_URL ?? "http://192.168.1.9:3002"
const hermesStatusPath = Bun.env.HERMES_STATUS_PATH ?? "/host/home/josh/.hermes/gateway_state.json"
const distPath = join(import.meta.dir, "..", "dist")
const envStorePath = Bun.env.ENV_STORE_PATH ?? "/app/data/envs.json"
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const reservedEnvNames = new Set(["__proto__", "constructor", "prototype"])
const maxEnvRequestBytes = 64 * 1024

type EnvValues = Record<string, string>

class EnvApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function isValidEnvName(name: string) {
  return envNamePattern.test(name) && !reservedEnvNames.has(name)
}

function parseEnvValues(value: unknown): EnvValues {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Environment store must be a JSON object")
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const result: EnvValues = Object.create(null)
  for (const [name, secret] of entries) {
    if (!isValidEnvName(name) || typeof secret !== "string") {
      throw new Error("Environment store contains an invalid entry")
    }
    result[name] = secret
  }
  return result
}

async function loadEnvValues(): Promise<EnvValues> {
  await mkdir(dirname(envStorePath), { recursive: true })
  const file = Bun.file(envStorePath)
  if (!(await file.exists())) return Object.create(null)
  return parseEnvValues(await file.json())
}

async function readRequestText(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

let envValues = await loadEnvValues()
let envWriteQueue: Promise<void> = Promise.resolve()

function updateEnvValues(change: (next: EnvValues) => void) {
  const operation = envWriteQueue.then(async () => {
    const next = Object.assign(Object.create(null), envValues) as EnvValues
    change(next)
    const temporaryPath = `${envStorePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, envStorePath)
    envValues = next
  })

  envWriteQueue = operation.catch(() => {})
  return operation
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init?.headers,
    },
  })
}

function parseDf(output: string): StorageRow[] {
  return output
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 6)
    .map(([filesystem, size, used, available, capacity, ...mountParts]) => ({
      filesystem,
      sizeKb: Number(size),
      usedKb: Number(used),
      availableKb: Number(available),
      capacity: Number(capacity.replace("%", "")),
      mount: mountParts.join(" "),
    }))
    .filter((row) => Number.isFinite(row.sizeKb) && Number.isFinite(row.usedKb))
}

async function collectStorage(): Promise<StorageResponse> {
  const proc = Bun.spawn(["df", "-kP", storagePath], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `df exited with status ${exitCode}`)
  }

  return {
    host: Bun.env.HOSTNAME ?? "linux-server",
    checkedAt: new Date().toISOString(),
    targetPath: storagePath,
    rows: parseDf(stdout),
  }
}

function getCheckUrl(url: string) {
  if (!appCheckBase) return url

  const publicUrl = new URL(url)
  const checkBase = new URL(appCheckBase)
  checkBase.port = publicUrl.port
  checkBase.pathname = publicUrl.pathname
  checkBase.search = publicUrl.search
  return checkBase.toString()
}

async function checkApp(item: NonNullable<NonNullable<HomerConfig["services"]>[number]["items"]>[number]): Promise<AppStatus> {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3500)
  const url = item.url ?? ""
  const checkUrl = getCheckUrl(url)

  try {
    const response = await fetch(checkUrl, {
      method: "GET",
      signal: controller.signal,
    })

    return {
      name: item.name ?? "Unknown",
      subtitle: item.subtitle ?? "",
      logo: item.logo,
      url,
      status: response.status < 500 ? "online" : "offline",
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } catch (error) {
    return {
      name: item.name ?? "Unknown",
      subtitle: item.subtitle ?? "",
      logo: item.logo,
      url,
      status: "offline",
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Request failed",
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function collectApps() {
  if (!homerConfigUrl && !homerConfigPath) {
    return {
      checkedAt: new Date().toISOString(),
      source: null,
      groups: [],
    }
  }

  let configText: string
  let source: string

  if (homerConfigPath) {
    const file = Bun.file(homerConfigPath)
    if (!(await file.exists())) {
      throw new Error(`App config file not found: ${homerConfigPath}`)
    }
    configText = await file.text()
    source = homerConfigPath
  } else {
    const response = await fetch(homerConfigUrl!)
    if (!response.ok) {
      throw new Error(`Homer config returned ${response.status}`)
    }
    configText = await response.text()
    source = homerConfigUrl!
  }

  const config = YAML.parse(configText) as HomerConfig
  const groups = await Promise.all(
    (config.services ?? []).map(async (group): Promise<AppGroup> => ({
      name: group.name ?? "Services",
      items: await Promise.all((group.items ?? []).filter((item) => item.url).map(checkApp)),
    })),
  )

  return {
    checkedAt: new Date().toISOString(),
    source,
    groups,
  }
}

async function collectHermesStatus(): Promise<HermesStatus> {
  const checkedAt = new Date().toISOString()
  const stateFile = Bun.file(hermesStatusPath)

  if (!(await stateFile.exists())) {
    return {
      status: "offline",
      gatewayState: null,
      activeAgents: 0,
      connectedPlatforms: 0,
      totalPlatforms: 0,
      pid: null,
      version: null,
      updatedAt: null,
      checkedAt,
      error: "Hermes gateway state file not found",
    }
  }

  try {
    const runtime = (await stateFile.json()) as {
      pid?: number
      start_time?: number
      gateway_state?: string
      active_agents?: number
      platforms?: Record<string, { state?: string }>
      updated_at?: string
      code_version?: string
    }
    const pid = Number.isInteger(runtime.pid) ? runtime.pid! : null
    const recordedStartTime = Number.isInteger(runtime.start_time) ? runtime.start_time! : null
    let liveStartTime: number | null = null

    if (pid !== null && existsSync(`/host/proc/${pid}/stat`)) {
      try {
        const stat = readFileSync(`/host/proc/${pid}/stat`, "utf8")
        const closingParen = stat.lastIndexOf(") ")
        const fields = closingParen === -1 ? [] : stat.slice(closingParen + 2).trim().split(/\s+/)
        const parsedStartTime = Number(fields[19])
        liveStartTime = Number.isInteger(parsedStartTime) ? parsedStartTime : null
      } catch {
        liveStartTime = null
      }
    }

    // Match Hermes' recorded process start time to the live kernel value so a
    // reused PID cannot make stale gateway state look current.
    const processRunning = pid !== null && recordedStartTime !== null && liveStartTime === recordedStartTime
    const platforms = Object.values(runtime.platforms ?? {})

    return {
      status: processRunning && runtime.gateway_state === "running" ? "online" : "offline",
      gatewayState: runtime.gateway_state ?? null,
      activeAgents: Number.isFinite(runtime.active_agents) ? runtime.active_agents! : 0,
      connectedPlatforms: platforms.filter((platform) => platform.state === "connected").length,
      totalPlatforms: platforms.length,
      pid,
      version: runtime.code_version ?? null,
      updatedAt: runtime.updated_at ?? null,
      checkedAt,
    }
  } catch (error) {
    return {
      status: "offline",
      gatewayState: null,
      activeAgents: 0,
      connectedPlatforms: 0,
      totalPlatforms: 0,
      pid: null,
      version: null,
      updatedAt: null,
      checkedAt,
      error: error instanceof Error ? error.message : "Unable to read Hermes status",
    }
  }
}

async function serveStatic(pathname: string) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname
  const file = Bun.file(join(distPath, cleanPath))

  if (await file.exists()) {
    return new Response(file)
  }

  return new Response(Bun.file(join(distPath, "index.html")))
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/api/health") {
      return json({ ok: true, checkedAt: new Date().toISOString() })
    }

    if (url.pathname === "/api/config") {
      return json({
        appName: Bun.env.APP_NAME ?? "Server Dash",
        publicLanHost: publicLanHost ?? null,
        publicTailscaleHost: publicTailscaleHost ?? null,
        workoutAppUrl,
        homerConfigured: Boolean(homerConfigUrl || homerConfigPath),
      })
    }

    if (url.pathname === "/api/storage") {
      try {
        return json(await collectStorage())
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : "Unable to read storage stats",
            targetPath: storagePath,
          },
          { status: 500 },
        )
      }
    }

    if (url.pathname === "/api/apps") {
      try {
        return json(await collectApps())
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : "Unable to read media stack apps",
            source: homerConfigUrl ?? null,
          },
          { status: 500 },
        )
      }
    }

    if (url.pathname === "/api/hermes") {
      return json(await collectHermesStatus())
    }

    if (url.pathname === "/api/envs" && request.method === "GET") {
      return json({ envs: Object.keys(envValues).sort() })
    }

    const envMatch = url.pathname.match(/^\/api\/envs\/([^/]+)$/)
    if (envMatch) {
      let name: string
      try {
        name = decodeURIComponent(envMatch[1])
      } catch {
        return json({ error: "Invalid environment name" }, { status: 400 })
      }
      if (!isValidEnvName(name)) {
        return json({ error: "Invalid environment name" }, { status: 400 })
      }

      if (request.method === "GET") {
        if (!Object.hasOwn(envValues, name)) {
          return json({ error: "Environment value not found" }, { status: 404 })
        }
        return json({ key: name, value: envValues[name] })
      }

      if (request.method === "PUT") {
        let body: unknown
        try {
          const text = await readRequestText(request, maxEnvRequestBytes)
          if (text === null) return json({ error: "Request body is too large" }, { status: 413 })
          body = JSON.parse(text)
        } catch {
          return json({ error: "Expected a JSON value" }, { status: 400 })
        }
        if (body === null || typeof body !== "object" || typeof (body as { value?: unknown }).value !== "string") {
          return json({ error: "Expected a string value" }, { status: 400 })
        }

        try {
          await updateEnvValues((next) => {
            next[name] = (body as { value: string }).value
          })
          return json({ saved: true, key: name })
        } catch {
          return json({ error: "Unable to save environment value" }, { status: 500 })
        }
      }

      if (request.method === "DELETE") {
        try {
          await updateEnvValues((next) => {
            if (!Object.hasOwn(next, name)) throw new EnvApiError(404, "Environment value not found")
            delete next[name]
          })
          return json({ deleted: true, key: name })
        } catch (error) {
          if (error instanceof EnvApiError) return json({ error: error.message }, { status: error.status })
          return json({ error: "Unable to delete environment value" }, { status: 500 })
        }
      }

      return json({ error: "Method not allowed" }, { status: 405 })
    }

    if (url.pathname.startsWith("/api/envs/")) {
      return json({ error: "Environment endpoint not found" }, { status: 404 })
    }

    if (url.pathname === "/api/envs" && request.method !== "GET") {
      return json({ error: "Method not allowed" }, { status: 405 })
    }

    if (existsSync(distPath)) {
      return serveStatic(url.pathname)
    }

    return json(
      {
        error: "Frontend build not found. Run `bun run build` or use Vite dev server.",
      },
      { status: 404 },
    )
  },
})

console.log(`server-dash listening on http://localhost:${port}`)
