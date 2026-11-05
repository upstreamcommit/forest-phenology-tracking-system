export const APP_NAME = 'Forest Phenology Explorer'

/** Sets the document title while the page is shown ("Data & methods · Forest Phenology …"). */
export function PageTitle({ children }: { children: string }) {
  return <title>{`${children} · ${APP_NAME}`}</title>
}
