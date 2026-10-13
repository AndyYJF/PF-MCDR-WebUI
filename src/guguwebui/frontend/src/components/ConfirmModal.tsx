import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'

type ConfirmModalProps = {
  isOpen: boolean
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
  children?: React.ReactNode
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger = false,
  children,
}) => (
  <Modal isOpen={isOpen} onClose={onCancel} closeLabel={cancelLabel} title={title}>
    <div className="space-y-5">
      {message && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{message}</p>}
      {children}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
          {danger && <AlertTriangle className="h-4 w-4" />}
          {confirmLabel}
        </button>
      </div>
    </div>
  </Modal>
)
