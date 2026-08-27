import { ArrowClockwise, HardDrives, LinkSimple, Robot, WarningCircle } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

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

type AppsResponse = {
  checkedAt: string
  source: string | null
  groups: Array<{
    name: string
    items: AppStatus[]
  }>
}

type PublicConfig = {
  appName: string
  publicLanHost: string | null
  publicTailscaleHost: string | null
  homerConfigured: boolean
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

function formatBytes(kb: number) {
  const bytes = kb * 1024
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

function getDeviceAwareUrl(url: string, config: PublicConfig | null) {
  if (!config?.publicLanHost || !config.publicTailscaleHost) {
    return url
  }

  const currentHost = window.location.hostname

  if (currentHost === config.publicTailscaleHost || currentHost.endsWith(`.${config.publicTailscaleHost}`)) {
    return url
  }

  const parsed = new URL(url)
  parsed.hostname = config.publicLanHost
  return parsed.toString()
}

function usePublicConfig() {
  const [data, setData] = useState<PublicConfig | null>(null)

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then(setData)
      .catch(() => {
        setData({
          appName: "Server Dash",
          publicLanHost: null,
          publicTailscaleHost: null,
          homerConfigured: false,
        })
      })
  }, [])

  return data
}

function useStorageStats() {
  const [data, setData] = useState<StorageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function load() {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/storage")
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? "Storage request failed")
      }

      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load storage stats")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return { data, error, isLoading, refresh: load }
}

function useApps() {
  const [data, setData] = useState<AppsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function load() {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/apps")
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? "App status request failed")
      }

      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load app status")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return { data, error, isLoading, refresh: load }
}

function useHermesStatus() {
  const [data, setData] = useState<HermesStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function load() {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/hermes")
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? "Hermes status request failed")
      }

      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Hermes status")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15_000)
    return () => window.clearInterval(timer)
  }, [])

  return { data, error, isLoading, refresh: load }
}

function UsageBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          value >= 90 ? "bg-destructive" : value >= 75 ? "bg-amber-600" : "bg-primary",
        )}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  )
}

function StorageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const publicConfig = usePublicConfig()
  const { data, error, isLoading, refresh } = useStorageStats()
  const apps = useApps()
  const hermes = useHermesStatus()

  const primaryDisk = data?.rows[0]
  const appTotals = useMemo(() => {
    const items = apps.data?.groups.flatMap((group) => group.items) ?? []
    return {
      total: items.length,
      online: items.filter((item) => item.status === "online").length,
    }
  }, [apps.data])
  const totals = useMemo(() => {
    if (!data?.rows.length) return null

    return data.rows.reduce(
      (acc, row) => ({
        sizeKb: acc.sizeKb + row.sizeKb,
        usedKb: acc.usedKb + row.usedKb,
        availableKb: acc.availableKb + row.availableKb,
      }),
      { sizeKb: 0, usedKb: 0, availableKb: 0 },
    )
  }, [data])

  return (
    <main className="min-h-[100dvh] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-4">
          <Card className="shadow-[0_18px_50px_-42px_rgba(15,23,42,0.55)]">
            <CardHeader className="gap-4 space-y-0 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{publicConfig?.appName ?? "Server Dash"}</p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Media stack</h1>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <Badge variant={appTotals.online === appTotals.total ? "default" : "destructive"} className="font-mono">
                  {appTotals.online}/{appTotals.total || 0} online
                </Badge>
                <Button variant="outline" size="sm" onClick={apps.refresh} disabled={apps.isLoading}>
                  <ArrowClockwise className={cn(apps.isLoading && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card className="shadow-[0_24px_70px_-50px_rgba(15,23,42,0.25)]">
            <CardContent className="p-3 sm:p-4">
              {apps.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <WarningCircle className="size-4" />
                    App status failed
                  </div>
                  <p>{apps.error}</p>
                </div>
              ) : null}

              {apps.data && !apps.data.groups.length ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Configure `HOMER_CONFIG_PATH` or `HOMER_CONFIG_URL` to import app links.
                </div>
              ) : apps.isLoading && !apps.data ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <Skeleton key={index} className="h-24 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {apps.data?.groups.map((group) => (
                    <div key={group.name} className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <h2 className="text-sm font-semibold">{group.name}</h2>
                        <span className="font-mono text-xs text-muted-foreground">
                          {group.items.filter((item) => item.status === "online").length}/{group.items.length}
                        </span>
                      </div>
                      <div className="grid gap-2">
                        {group.items.map((item) => (
                          <AppTile key={item.name} item={item} publicConfig={publicConfig} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
          <HermesCard {...hermes} />

          <Card className="shadow-[0_24px_70px_-54px_rgba(15,23,42,0.4)]">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <HardDrives weight="duotone" className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">System</p>
                  <CardTitle className="text-lg">Storage</CardTitle>
                </div>
              </div>
              <Button variant="outline" size="icon" onClick={refresh} disabled={isLoading} aria-label="Refresh storage stats">
                <ArrowClockwise className={cn(isLoading && "animate-spin")} />
              </Button>
            </CardHeader>

            <CardContent className="space-y-4 p-4 pt-0">
              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    <WarningCircle className="size-4" />
                    Storage read failed
                  </div>
                  <p>{error}</p>
                </div>
              ) : null}

              {isLoading && !data ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : data && primaryDisk && totals ? (
                <>
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="font-mono text-4xl font-semibold tracking-tight">{primaryDisk.capacity}%</p>
                        <p className="mt-1 text-xs text-muted-foreground">primary mount used</p>
                      </div>
                      <Badge variant={primaryDisk.capacity >= 90 ? "destructive" : "secondary"} className="font-mono">
                        {primaryDisk.mount}
                      </Badge>
                    </div>
                    <UsageBar value={primaryDisk.capacity} />
                    <div className="grid grid-cols-2 gap-2">
                      <Metric label="Used" value={formatBytes(primaryDisk.usedKb)} />
                      <Metric label="Free" value={formatBytes(primaryDisk.availableKb)} />
                    </div>
                  </div>

                  <div className="space-y-2 border-t pt-3">
                    {data.rows.map((row) => (
                      <div key={`${row.filesystem}-${row.mount}`} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-medium">{row.mount}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{row.filesystem}</p>
                          </div>
                          <p className="font-mono text-sm font-semibold">{row.capacity}%</p>
                        </div>
                        <UsageBar value={row.capacity} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  No storage filesystems were returned by the server.
                </div>
              )}
            </CardContent>

            <CardFooter className="block border-t p-4 text-xs text-muted-foreground">
              <p className="font-mono">{data?.host ?? "linux-server"}</p>
              <p className="mt-1">
                Target {data?.targetPath ?? "/"} · Updated{" "}
                {data ? new Date(data.checkedAt).toLocaleTimeString() : "pending"}
              </p>
            </CardFooter>
          </Card>
        </aside>
      </div>
    </main>
  )
}

function HermesCard({
  data,
  error,
  isLoading,
  refresh,
}: {
  data: HermesStatus | null
  error: string | null
  isLoading: boolean
  refresh: () => Promise<void>
}) {
  const isOnline = data?.status === "online"
  const statusLabel = data ? data.status : "checking"

  return (
    <Card className="shadow-[0_24px_70px_-54px_rgba(15,23,42,0.4)]">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Robot weight="duotone" className="size-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Agent</p>
            <CardTitle className="text-lg">Hermes</CardTitle>
          </div>
        </div>
        <Button variant="outline" size="icon" onClick={refresh} disabled={isLoading} aria-label="Refresh Hermes status">
          <ArrowClockwise className={cn(isLoading && "animate-spin")} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        {error || data?.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <WarningCircle className="size-4" />
              Hermes status unavailable
            </div>
            <p>{error ?? data?.error}</p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", isOnline ? "bg-primary" : "bg-destructive")} />
            <span className="text-sm font-medium">Gateway</span>
          </div>
          <Badge variant={!data ? "secondary" : isOnline ? "default" : "destructive"} className="font-mono">
            {statusLabel}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">Active agents</p>
            <p className="mt-1 font-mono font-semibold">{data?.activeAgents ?? "—"}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">Platforms</p>
            <p className="mt-1 font-mono font-semibold">
              {data ? `${data.connectedPlatforms}/${data.totalPlatforms}` : "—"}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {data?.version ? `v${data.version} · ` : ""}
          Updated {data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "pending"}
        </p>
      </CardContent>
    </Card>
  )
}

function AppTile({ item, publicConfig }: { item: AppStatus; publicConfig: PublicConfig | null }) {
  return (
    <a
      href={getDeviceAwareUrl(item.url, publicConfig)}
      target="_blank"
      rel="noreferrer"
      className="grid min-h-24 grid-cols-[2.75rem_1fr] gap-3 rounded-md border bg-background/70 p-3 transition-[background,transform,border-color] hover:border-primary/40 hover:bg-accent/35 active:translate-y-px"
    >
      <div className="flex size-11 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {item.logo ? <img src={item.logo} alt="" className="size-7 object-contain" /> : <LinkSimple className="size-4 text-muted-foreground" />}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", item.status === "online" ? "bg-primary" : "bg-destructive")} />
              <p className="truncate text-sm font-semibold">{item.name}</p>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{item.subtitle}</p>
          </div>
          <Badge variant={item.status === "online" ? "default" : "destructive"} className="shrink-0 font-mono">
            {item.status}
          </Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {item.statusCode ? `${item.statusCode} · ` : ""}
          {item.latencyMs ?? 0}ms
        </p>
      </div>
    </a>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-3">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
