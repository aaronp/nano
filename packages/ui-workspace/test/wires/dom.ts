import { GlobalRegistrator } from '@happy-dom/global-registrator'
// the element links Google Fonts into the document head; happy-dom won't fetch it, so treat that as loaded
GlobalRegistrator.register({ settings: { handleDisabledFileLoadingAsSuccess: true } })
