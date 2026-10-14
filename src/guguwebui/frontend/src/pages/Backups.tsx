import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Tag,
  Trash2,
} from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ConfirmModal } from '../components/ConfirmModal'
import { Modal } from '../components/Modal'
import api, { unwrapData } from '../utils/api'

type Provider = 'primebackup' | 'quickbackupm'
type ProviderStatus = { id: Provider; name: string; available: boolean; installed?: boolean; enabled?: boolean; state?: 'missing' | 'disabled' | 'ready'; guide_url?: string | null; storage?: string | null }
type Backup = { provider: Provider; id: string; slot?: string | null; comment?: string; created_at?: number | null; creator?: string; size?: string | null; raw_size?: number | null; stored_size?: number | null; file_count?: number | null; format?: string | null; targets?: unknown; tags?: unknown }

const formatDate = (value?: number | null) => value ? new Date(value * 1000).toLocaleString() : '-'
const formatBytes = (value?: number | null) => value == null ? '-' : `${(value / 1024 / 1024).toFixed(2)} MiB`
const formatCreator = (value: string | undefined, fallback: string) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return fallback
  if (/CapturingCommandSource|CommandSource object at|command_source:\s*</i.test(text)) return 'WebUI'
  return text
}
const formatTargets = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return Object.keys(value as object).join(', ')
  return ''
}

const Backups: React.FC = () => {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<Provider>('primebackup')
  const [items, setItems] = useState<Backup[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [noticeGuide, setNoticeGuide] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ action: 'restore' | 'delete'; item: Backup } | null>(null)
  const [rename, setRename] = useState<Backup | null>(null)
  const [makeOpen, setMakeOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupEnabled, setSetupEnabled] = useState(true)
  const [setupRoot, setSetupRoot] = useState('./pb_files')
  const [setupTargets, setSetupTargets] = useState('world')

  const currentProvider = providers.find((item) => item.id === provider)
  const providerInstalled = currentProvider?.available ?? false
  const providerDisabled = currentProvider?.state === 'disabled'
  const isPrime = provider === 'primebackup'
  const installUrl = isPrime ? '/online-plugins?q=PrimeBackup&detail=prime_backup' : '/online-plugins?q=Quick+Backup+Multi&detail=quick_backup_multi'
  const providerLabel = isPrime ? 'PrimeBackup' : 'QuickBackupM'
  const providerTone = isPrime
    ? { shell: 'border-amber-200/80 bg-[#fffaf0] dark:border-amber-900/60 dark:bg-amber-950/10', text: 'text-amber-700 dark:text-amber-300' }
    : { shell: 'border-cyan-200/80 bg-[#f3fcfd] dark:border-cyan-900/60 dark:bg-cyan-950/10', text: 'text-cyan-700 dark:text-cyan-300' }

  const loadStatus = useCallback(async () => {
    try {
      const response = await api.get('/backups/status')
      setProviders(unwrapData<{ providers?: ProviderStatus[] }>(response, {}).providers || [])
    } catch { setProviders([]) }
  }, [])

  const openPrimeSetup = async () => {
    setSetupOpen(true)
    setSetupLoading(true)
    try {
      const response = await api.get('/backups/primebackup/setup')
      const data = unwrapData<{ enabled?: boolean; storage_root?: string; targets?: string[] }>(response, {})
      setSetupEnabled(data.enabled !== false)
      setSetupRoot(data.storage_root || './pb_files')
      setSetupTargets((data.targets || ['world']).join(', '))
    } catch { setNotice(t('page.backups.setup_load_failed')) }
    finally { setSetupLoading(false) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/backups', { params: { provider, page, per_page: 20 } })
      const data = unwrapData<{ items?: Backup[]; total?: number }>(response, {})
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setNotice(message || t('page.backups.load_failed'))
    } finally { setLoading(false) }
  }, [page, provider, t])

  useEffect(() => { void loadStatus(); void load() }, [load, loadStatus])

  const savePrimeSetup = async () => {
    setSetupLoading(true)
    try {
      await api.put('/backups/primebackup/setup', { enabled: setupEnabled, storage_root: setupRoot, targets: setupTargets.split(',').map((item) => item.trim()).filter(Boolean) })
      setNotice(t('page.backups.setup_success'))
      setSetupOpen(false)
      await loadStatus()
      await load()
    } catch (error) {
      const payload = (error as { response?: { data?: { message?: string } } }).response?.data
      setNotice(payload?.message || t('page.backups.setup_failed'))
    } finally { setSetupLoading(false) }
  }

  const operation = async (action: string, item?: Backup, value?: string) => {
    if (!providerInstalled) {
      setNotice(t('page.backups.plugin_required'))
      setNoticeGuide(providerDisabled ? (currentProvider?.guide_url || null) : null)
      return
    }
    try {
      await api.post('/backups/operations', { provider, action, backup_id: item?.id, comment: value })
      setNotice(t('page.backups.operation_success'))
      setNoticeGuide(null)
      setRename(null)
      setMakeOpen(false)
      setConfirm(null)
      setComment('')
      void load()
    } catch (error) {
      const payload = (error as { response?: { data?: { message?: string; data?: { guide_url?: string | null } } } }).response?.data
      setNotice(payload?.message || t('page.backups.operation_failed'))
      setNoticeGuide(payload?.data?.guide_url || null)
    }
  }

  const summary = useMemo(() => ({
    stored: items.reduce((sum, item) => sum + (item.stored_size || 0), 0),
    files: items.reduce((sum, item) => sum + (item.file_count || 0), 0),
  }), [items])

  const switchProvider = (next: Provider) => {
    setProvider(next)
    setPage(1)
    setNotice('')
    setNoticeGuide(null)
  }

  const openCreate = () => { setComment(''); setMakeOpen(true) }

  const renderActionButtons = (item: Backup) => (
    <div className="flex items-center justify-end gap-1">
      <button type="button" title={t('page.backups.restore')} onClick={() => setConfirm({ action: 'restore', item })} className={`rounded-md p-2 ${providerTone.text} transition hover:bg-slate-100 dark:hover:bg-slate-800`}><RotateCcw className="h-4 w-4" /></button>
      <button type="button" title={t('page.backups.rename')} onClick={() => { setRename(item); setComment(item.comment || '') }} className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
      <button type="button" title={t('common.delete')} onClick={() => setConfirm({ action: 'delete', item })} className="rounded-md p-2 text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
    </div>
  )

  const renderAvailability = () => providerInstalled
    ? <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{t('page.backups.connected')}</div>
    : <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" />{providerDisabled ? t('page.backups.disabled_short') : t('page.backups.not_installed_short')}</div>

  return (
    <div className="mx-auto max-w-[1480px] pb-10">
      <section className={`overflow-hidden rounded-[8px] border ${providerTone.shell}`}>
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl"><div className={`mb-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] ${providerTone.text}`}><Archive className="h-4 w-4" />{t('page.backups.workspace_label')}</div><h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">{t('page.backups.title')}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">{t('page.backups.subtitle')}</p></div>
          <div className="flex flex-wrap items-center gap-2">{isPrime && providerDisabled && <button type="button" onClick={() => void openPrimeSetup()} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white/70 px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-white dark:border-amber-800 dark:bg-slate-900/60 dark:text-amber-300"><Settings2 className="h-4 w-4" />{t('page.backups.quick_setup')}</button>}<button type="button" disabled={!providerInstalled} onClick={openCreate} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${isPrime ? 'bg-amber-600 hover:bg-amber-700' : 'bg-cyan-700 hover:bg-cyan-800'}`}><Plus className="h-4 w-4" />{t('page.backups.create')}</button><button type="button" onClick={() => { void loadStatus(); void load() }} title={t('common.refresh')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200"><RefreshCw className="h-4 w-4" />{t('common.refresh')}</button></div>
        </div>
        <div className="grid border-t border-inherit sm:grid-cols-2">
          <button type="button" onClick={() => switchProvider('primebackup')} className={`flex items-center gap-4 px-5 py-4 text-left transition sm:px-8 ${isPrime ? 'bg-white/80 dark:bg-slate-900/50' : 'opacity-60 hover:opacity-100'}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-md shadow-amber-500/20"><Database className="h-5 w-5" /></span><span className="min-w-0"><span className="block font-bold text-slate-900 dark:text-white">PrimeBackup</span><span className="mt-0.5 block text-xs text-slate-500">{t('page.backups.prime_descriptor')}</span></span>{isPrime && <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" />}</button>
          <button type="button" onClick={() => switchProvider('quickbackupm')} className={`flex items-center gap-4 border-t border-inherit px-5 py-4 text-left transition sm:border-l sm:border-t-0 sm:px-8 ${!isPrime ? 'bg-white/80 dark:bg-slate-900/50' : 'opacity-60 hover:opacity-100'}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-600 text-white shadow-md shadow-cyan-600/20"><Layers3 className="h-5 w-5" /></span><span className="min-w-0"><span className="block font-bold text-slate-900 dark:text-white">QuickBackupM</span><span className="mt-0.5 block text-xs text-slate-500">{t('page.backups.quick_descriptor')}</span></span>{!isPrime && <span className="ml-auto h-2 w-2 rounded-full bg-cyan-600" />}</button>
        </div>
      </section>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 px-1"><div className="flex items-center gap-2">{renderAvailability()}<span className="text-xs text-slate-400">{providerLabel}</span></div>{currentProvider?.storage && <div className="flex max-w-full items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><FolderOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate font-mono" title={currentProvider.storage}>{currentProvider.storage}</span></div>}</div>
      {!providerInstalled && <div className="mt-4 flex items-start gap-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold">{providerDisabled ? t('page.backups.plugin_disabled') : t('page.backups.plugin_required')}</p><p className="mt-1 leading-6">{providerDisabled ? t('page.backups.plugin_disabled_hint') : t('page.backups.plugin_required_hint')}</p>{providerDisabled ? <a href={currentProvider?.guide_url || '#'} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"><ExternalLink className="h-4 w-4" />{t('page.backups.open_plugin_guide')}</a> : <Link to={installUrl} className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"><ExternalLink className="h-4 w-4" />{t('page.backups.install_plugin')}</Link>}</div></div>}
      {notice && <div className="mt-4 rounded-[8px] border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200"><p>{notice}</p>{noticeGuide && <a href={noticeGuide} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold underline"><ExternalLink className="h-3.5 w-3.5" />{t('page.backups.open_plugin_guide')}</a>}</div>}

      {isPrime ? <section className={`mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_285px] ${!providerInstalled ? 'pointer-events-none opacity-60' : ''}`}>
        <div className="min-w-0 rounded-[8px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-slate-800 sm:px-6"><div><div className="flex items-center gap-2 text-amber-700 dark:text-amber-300"><Database className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.16em]">{t('page.backups.prime_ledger')}</span></div><h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{t('page.backups.prime_snapshots')}</h2></div><div className="flex items-center gap-5 text-xs text-slate-500"><span><strong className="text-slate-900 dark:text-white">{total}</strong> {t('page.backups.records')}</span><span><strong className="text-slate-900 dark:text-white">{formatBytes(summary.stored)}</strong> {t('page.backups.indexed')}</span></div></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/60"><tr><th className="px-5 py-3">{t('page.backups.id')}</th><th className="px-5 py-3">{t('page.backups.comment')}</th><th className="px-5 py-3">{t('page.backups.created')}</th><th className="px-5 py-3">{t('page.backups.prime_targets')}</th><th className="px-5 py-3">{t('page.backups.size')}</th><th className="px-5 py-3 text-right">{t('page.backups.actions')}</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{loading ? <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">{t('common.loading')}</td></tr> : items.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">{t('page.backups.empty')}</td></tr> : items.map((item) => <tr key={item.id} className="transition hover:bg-amber-50/40 dark:hover:bg-amber-950/10"><td className="px-5 py-4"><span className="font-mono font-semibold text-amber-700 dark:text-amber-300">#{item.id}</span><span className="mt-1 block text-[11px] text-slate-400">{item.file_count ? `${item.file_count} ${t('page.backups.files')}` : t('page.backups.snapshot')}</span></td><td className="max-w-[220px] px-5 py-4"><span className="block truncate font-medium text-slate-800 dark:text-slate-200">{item.comment || t('page.backups.untitled')}</span><span className="mt-1 block text-xs text-slate-400">{formatCreator(item.creator, t('page.backups.system_created'))}</span></td><td className="whitespace-nowrap px-5 py-4 text-slate-600 dark:text-slate-300"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{formatDate(item.created_at)}</span></td><td className="max-w-[190px] px-5 py-4"><span className="block truncate text-xs text-slate-500" title={formatTargets(item.targets)}>{formatTargets(item.targets) || '-'}</span></td><td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700 dark:text-slate-200">{item.size || formatBytes(item.stored_size)}</td><td className="px-5 py-4">{renderActionButtons(item)}</td></tr>)}</tbody></table></div></div>
        <aside className="rounded-[8px] border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-950/10"><div className="flex items-center gap-2 text-amber-700 dark:text-amber-300"><ShieldCheck className="h-5 w-5" /><h2 className="font-bold">{t('page.backups.prime_control')}</h2></div><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('page.backups.prime_control_hint')}</p><dl className="mt-6 space-y-4 text-sm"><div className="border-b border-amber-200/80 pb-3 dark:border-amber-900/50"><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('page.backups.storage_root')}</dt><dd className="mt-1 break-all font-mono text-xs text-slate-800 dark:text-slate-200">{currentProvider?.storage || t('page.backups.unavailable')}</dd></div><div className="border-b border-amber-200/80 pb-3 dark:border-amber-900/50"><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('page.backups.page_files')}</dt><dd className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{summary.files || '-'}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('page.backups.state')}</dt><dd className="mt-1 flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{providerInstalled ? t('page.backups.indexed_state') : t('page.backups.pending_state')}</dd></div></dl>{providerDisabled && <button type="button" onClick={() => void openPrimeSetup()} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-900/30"><Settings2 className="h-4 w-4" />{t('page.backups.quick_setup')}</button>}</aside>
      </section> : <section className={`mt-5 ${!providerInstalled ? 'pointer-events-none opacity-60' : ''}`}><div className="rounded-[8px] border border-cyan-200 bg-white dark:border-cyan-900/60 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-cyan-100 bg-cyan-50/60 px-5 py-5 dark:border-cyan-900/50 dark:bg-cyan-950/15 sm:px-7"><div><div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-300"><Layers3 className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.16em]">{t('page.backups.quick_slots')}</span></div><h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{t('page.backups.quick_snapshots')}</h2></div><div className="flex items-center gap-4 text-xs text-slate-500"><span><strong className="text-slate-900 dark:text-white">{total}</strong> {t('page.backups.slots')}</span><span className="hidden items-center gap-1 sm:flex"><HardDrive className="h-3.5 w-3.5" />{currentProvider?.storage ? t('page.backups.local_storage') : t('page.backups.storage_unavailable')}</span></div></div><div className="p-5 sm:p-7">{loading ? <div className="py-12 text-center text-slate-500">{t('common.loading')}</div> : items.length === 0 ? <div className="py-12 text-center text-slate-500">{t('page.backups.empty')}</div> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="group relative overflow-hidden rounded-[8px] border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-cyan-700"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-100 font-mono text-lg font-black text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200">{item.slot || item.id}</span><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('page.backups.slot')}</p><p className="font-semibold text-slate-900 dark:text-white">{item.comment || t('page.backups.untitled')}</p></div></div></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-800"><div><span className="block text-slate-400">{t('page.backups.created')}</span><span className="mt-1 block font-medium text-slate-700 dark:text-slate-300">{formatDate(item.created_at)}</span></div><div><span className="block text-slate-400">{t('page.backups.size')}</span><span className="mt-1 block font-medium text-slate-700 dark:text-slate-300">{item.size || formatBytes(item.stored_size)}</span></div></div><div className="mt-4 flex items-center justify-between"><span className="inline-flex max-w-[55%] items-center gap-1 truncate text-xs text-slate-400"><Tag className="h-3.5 w-3.5 shrink-0" />{formatTargets(item.targets) || t('page.backups.default_target')}</span>{renderActionButtons(item)}</div></article>)}</div>}</div></div></section>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-slate-500"><span>{t('page.backups.total', { count: total })}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 transition hover:bg-white disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900">{t('common.previous')}</button><span className="min-w-8 text-center font-mono">{page}</span><button type="button" disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 transition hover:bg-white disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900">{t('common.next')}</button></div></div>
      <ConfirmModal isOpen={!!confirm} title={confirm?.action === 'restore' ? t('page.backups.restore') : t('page.backups.delete')} message={confirm?.action === 'restore' ? t('page.backups.restore_confirm') : t('page.backups.delete_confirm')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} danger={confirm?.action === 'delete'} onCancel={() => setConfirm(null)} onConfirm={() => confirm && void operation(confirm.action, confirm.item)} />
      <ConfirmModal isOpen={!!rename} title={t('page.backups.rename')} message={t('page.backups.rename_hint')} confirmLabel={t('common.save')} cancelLabel={t('common.cancel')} onCancel={() => setRename(null)} onConfirm={() => rename && void operation('rename', rename, comment)}><input value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-800" maxLength={200} /></ConfirmModal>
      <ConfirmModal isOpen={makeOpen} title={t('page.backups.create')} message={t('page.backups.create_hint')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} onCancel={() => setMakeOpen(false)} onConfirm={() => void operation('make', undefined, comment)}><input value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-800" maxLength={200} /></ConfirmModal>
      <Modal isOpen={setupOpen} onClose={() => !setupLoading && setSetupOpen(false)} closeLabel={t('common.cancel')} title={t('page.backups.quick_setup')}><div className="space-y-5"><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t('page.backups.quick_setup_hint')}</p><label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={setupEnabled} onChange={(event) => setSetupEnabled(event.target.checked)} disabled={setupLoading} className="h-4 w-4" />{t('page.backups.enable_primebackup')}</label><label className="block text-sm font-semibold"><span>{t('page.backups.storage_root')}</span><input value={setupRoot} onChange={(event) => setSetupRoot(event.target.value)} disabled={setupLoading} className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-800" /></label><label className="block text-sm font-semibold"><span>{t('page.backups.targets')}</span><input value={setupTargets} onChange={(event) => setSetupTargets(event.target.value)} disabled={setupLoading} placeholder="world, world_nether, world_the_end" className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-800" /></label><p className="text-xs text-slate-500">{t('page.backups.reload_after_save')}</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setSetupOpen(false)} disabled={setupLoading} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button><button type="button" onClick={() => void savePrimeSetup()} disabled={setupLoading} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{setupLoading ? t('common.loading') : t('common.save')}</button></div></div></Modal>
    </div>
  )
}

export default Backups
