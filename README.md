# Ojos · MVP con cámara

Ojos muestra el entorno del astronauta y comparte observaciones y avisos con **https://centrocontrolneuro.netlify.app**. Utiliza la cámara integrada del teléfono o computadora, sin dispositivos adicionales. Conserva Expo SDK 58, React Native y Expo Router.

## Conectar

1. En CentroControl inicia una sesión con cámara.
2. En la tarjeta de un astronauta abre «Conectar ojos5» y utiliza ese enlace en el dispositivo.
3. También puedes pegar el enlace en la aplicación Expo. La conexión queda asociada a ese astronauta.
4. «Iniciar observación» envía un fotograma cada veinte segundos mientras la cámara está activa. «Analizar ahora» envía uno a petición.

La IA describe la escena y posibles detonadores visuales. El astronauta recibe una sugerencia y puede aceptar, descartar o indicar si ayudó. El estado emocional puede comunicarse voluntariamente; se identifica como respuesta del astronauta, no como una lectura de la cámara.

## Ejecutar

```sh
npm ci
npm run web
# o npm start para un dispositivo con Expo SDK 58 compatible
```

Requiere Node 22.18 o posterior. Las cámaras web necesitan localhost o HTTPS en el propio dispositivo. Para conectarse desde otro teléfono utiliza el sitio publicado. Las pruebas nativas requieren un dispositivo físico compatible.

## Captura y análisis

- Se solicita cámara, sin micrófono ni grabación de video.
- La cámara se libera al salir o pasar a segundo plano. La captura periódica no envía imágenes cuando la app está en segundo plano o la pestaña está oculta.
- Solo se envía el fotograma al iniciar explícitamente el análisis. El servidor conserva la descripción, los eventos y las respuestas, no la imagen.
- Expo Camera genera en nativo un archivo temporal de captura en la caché del sistema.
- Web permite escuchar la sugerencia mediante la voz del navegador. En nativo los mensajes son accesibles al lector de pantalla.
- La demo visual muestra escenas simuladas y lo indica expresamente. No analiza imágenes reales.
- El proveedor visual se configura en el servidor de CentroControl. La aplicación móvil no contiene sus credenciales.

## Verificar

```sh
npm run typecheck
npm run lint
npm test
npm run export:web
```

La exportación genera `dist/`. El contrato, el cliente y la asistencia web se sincronizan con `CentroControl/scripts/sync-ojos.mjs`. Cada repositorio conserva los archivos necesarios para compilar de forma independiente.
