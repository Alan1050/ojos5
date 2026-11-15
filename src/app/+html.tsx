import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();
  return <html {...htmlAttributes} lang="es"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><title>Ojos · Cámara en vivo</title><meta name="description" content="Tu cámara en vivo, a pantalla completa. Sin audio ni grabaciones."/><ScrollViewStyleReset/>{headNodes}</head><body {...bodyAttributes}>{children}{bodyNodes}</body></html>;
}
