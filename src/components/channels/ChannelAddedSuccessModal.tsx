import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

type Props = {
  open: boolean
  channelName?: string | null
  /** How many channels were just added (bulk). */
  addedCount?: number
  onContinueAdding: () => void
  onGoToChannelsList: () => void
  /** Optional extra body (e.g. tag picker in parent channel manager). */
  children?: ReactNode
  /** Disable footer actions while a follow-up save runs. */
  busy?: boolean
}

export function ChannelAddedSuccessModal({
  open,
  channelName,
  addedCount = 1,
  onContinueAdding,
  onGoToChannelsList,
  children,
  busy = false,
}: Props) {
  const { t } = useTranslation()
  const title =
    addedCount > 1
      ? t('channels.channelsAddedCount', { count: addedCount })
      : t('channels.channelAddedTitle')

  return (
    <Modal
      open={open}
      onClose={onGoToChannelsList}
      title={title}
      bodyClassName={children ? 'max-h-[70vh] overflow-y-auto' : undefined}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={onContinueAdding}
          >
            {t('channels.addMoreChannels')}
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={onGoToChannelsList}
          >
            {busy ? t('common.loading') : t('channels.goToApprovedChannels')}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
        {addedCount > 1
          ? t('channels.addSuccessBodyMany', { count: addedCount })
          : channelName
            ? t('channels.addSuccessBodyNamed', { name: channelName })
            : t('channels.addSuccessBodySimple')}
      </p>
      {children}
    </Modal>
  )
}
