import { AlertTriangle, ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
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
  const installUrl = provider === 'primebackup'
    ? '/online-plugins?q=PrimeBackup&detail=prime_backup'
    : '/online-plugins?q=Quick+Backup+Multi&detail=quick_backup_multi'

  const loadStatus = useCallback(async () => {
    try {
      const response = await api.get('/backups/status')
      setProviders(unwrapData<{ providers?: ProviderStatus[] }>(response, {}).providers || [])
    } catch {
      setProviders([])
    }
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
    } catch {
      setNotice(t('page.backups.setup_load_failed'))
    } finally {
      setSetupLoading(false)
    }
  }

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
    } finally {
      setSetupLoading(false)
    }
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

  const operation = async (action: string, item?: Backup, value?: string) => {
    if (!providerInstalled) {
      setNotice(t('page.backups.plugin_required'))
      setNoticeGuide(providerDisabled ? (currentProvider?.guide_url || null) : null)
      return
    }
    try {
      await api.post('/backups/operations', { provider, action, backup_id: item?.id, comment: value })
      setNotice(t('page.backups.operation_success'))
      setRename(null)
      setMakeOpen(false)
      setConfirm(null)
      setComment('')
      void load()
    } catch (error) {
      const payload = (error as { response?: { data?: { message?: string; data?: { guide_url?: string | null } } } }).response?.data
      const message = payload?.message
      setNotice(message || t('page.backups.operation_failed'))
      setNoticeGuide(payload?.data?.guide_url || null)
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('page.backups.title')}</h1><p className="text-sm text-slate-500">{t('page.backups.subtitle')}</p></div>
      <div className="flex gap-2">{provider === 'primebackup' && providerDisabled && <button type="button" onClick={() => void openPrimeSetup()} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-300"><Settings2 className="h-4 w-4" />{t('page.backups.quick_setup')}</button>}<button type="button" disabled={!providerInstalled} onClick={() => setMakeOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" />{t('page.backups.create')}</button><button type="button" onClick={() => { void loadStatus(); void load() }} title={t('common.refresh')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />{t('common.refresh')}</button></div>
    </div>
    {!providerInstalled && <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold">{providerDisabled ? t('page.backups.plugin_disabled') : t('page.backups.plugin_required')}</p><p className="mt-1">{providerDisabled ? t('page.backups.plugin_disabled_hint') : t('page.backups.plugin_required_hint')}</p>{providerDisabled ? <a href={currentProvider?.guide_url || '#'} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"><ExternalLink className="h-4 w-4" />{t('page.backups.open_plugin_guide')}</a> : <Link to={installUrl} className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"><ExternalLink className="h-4 w-4" />{t('page.backups.install_plugin')}</Link>}</div></div>}
    <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
      {(['primebackup', 'quickbackupm'] as Provider[]).map((id) => <button key={id} type="button" onClick={() => { setProvider(id); setPage(1) }} className={`px-4 py-2 text-sm font-semibold border-b-2 ${provider === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>{id === 'primebackup' ? 'PrimeBackup' : 'QuickBackupM'}</button>)}
    </div>
    {notice && <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-200"><p>{notice}</p>{noticeGuide && <a href={noticeGuide} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold underline"><ExternalLink className="h-3.5 w-3.5" />{t('page.backups.open_plugin_guide')}</a>}</div>}
    <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${!providerInstalled ? 'pointer-events-none opacity-60' : ''}`}>
      <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60"><tr><th className="px-4 py-3">{t('page.backups.id')}</th><th className="px-4 py-3">{t('page.backups.comment')}</th><th className="px-4 py-3">{t('page.backups.created')}</th><th className="px-4 py-3">{t('page.backups.size')}</th><th className="px-4 py-3 text-right">{t('page.backups.actions')}</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{loading ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">{t('common.loading')}</td></tr> : items.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">{t('page.backups.empty')}</td></tr> : items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-mono">{item.slot || item.id}</td><td className="px-4 py-3">{item.comment || '-'}</td><td className="px-4 py-3">{formatDate(item.created_at)}</td><td className="px-4 py-3">{item.size || formatBytes(item.stored_size)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" title={t('page.backups.restore')} onClick={() => setConfirm({ action: 'restore', item })} className="rounded p-2 text-blue-600 hover:bg-blue-50"><RotateCcw className="h-4 w-4" /></button><button type="button" title={t('page.backups.rename')} onClick={() => { setRename(item); setComment(item.comment || '') }} className="rounded p-2 text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" title={t('common.delete')} onClick={() => setConfirm({ action: 'delete', item })} className="rounded p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button></div></td></tr>)}</tbody></table>
    </div>
    <div className="flex items-center justify-between text-sm text-slate-500"><span>{t('page.backups.total', { count: total })}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((v) => v - 1)} className="rounded border px-3 py-1 disabled:opacity-40">{t('common.previous')}</button><span className="px-2 py-1">{page}</span><button type="button" disabled={page * 20 >= total} onClick={() => setPage((v) => v + 1)} className="rounded border px-3 py-1 disabled:opacity-40">{t('common.next')}</button></div></div>
    <ConfirmModal isOpen={!!confirm} title={confirm?.action === 'restore' ? t('page.backups.restore') : t('page.backups.delete')} message={confirm?.action === 'restore' ? t('page.backups.restore_confirm') : t('page.backups.delete_confirm')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} danger={confirm?.action === 'delete'} onCancel={() => setConfirm(null)} onConfirm={() => confirm && void operation(confirm.action, confirm.item)} />
    <ConfirmModal isOpen={!!rename} title={t('page.backups.rename')} message={t('page.backups.rename_hint')} confirmLabel={t('common.save')} cancelLabel={t('common.cancel')} onCancel={() => setRename(null)} onConfirm={() => rename && void operation('rename', rename, comment)}><input value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-800" maxLength={200} /></ConfirmModal>
    <ConfirmModal isOpen={makeOpen} title={t('page.backups.create')} message={t('page.backups.create_hint')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} onCancel={() => setMakeOpen(false)} onConfirm={() => void operation('make', undefined, comment)}><input value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-800" maxLength={200} /></ConfirmModal>
    <Modal isOpen={setupOpen} onClose={() => !setupLoading && setSetupOpen(false)} closeLabel={t('common.cancel')} title={t('page.backups.quick_setup')}>
      <div className="space-y-5">
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t('page.backups.quick_setup_hint')}</p>
        <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={setupEnabled} onChange={(event) => setSetupEnabled(event.target.checked)} disabled={setupLoading} className="h-4 w-4" />{t('page.backups.enable_primebackup')}</label>
        <label className="block text-sm font-semibold"><span>{t('page.backups.storage_root')}</span><input value={setupRoot} onChange={(event) => setSetupRoot(event.target.value)} disabled={setupLoading} className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-800" /></label>
        <label className="block text-sm font-semibold"><span>{t('page.backups.targets')}</span><input value={setupTargets} onChange={(event) => setSetupTargets(event.target.value)} disabled={setupLoading} placeholder="world, world_nether, world_the_end" className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-sm dark:bg-slate-800" /></label>
        <p className="text-xs text-slate-500">{t('page.backups.reload_after_save')}</p>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setSetupOpen(false)} disabled={setupLoading} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button><button type="button" onClick={() => void savePrimeSetup()} disabled={setupLoading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{setupLoading ? t('common.loading') : t('common.save')}</button></div>
      </div>
    </Modal>
  </div>
}

export default Backups
