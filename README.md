# SafeWalk Prototype (React + Firebase)

Prototipo tipo SafeWalk con:

- Compartir ruta en vivo con contactos de confianza
- Mapa en vivo con ruta sugerida y posicion actual
- Guardar, editar y eliminar contactos
- Integracion con Firebase Auth + Firestore para sincronizar contactos
- Fallback a almacenamiento local si Firebase no esta configurado
- Alertas de desvio y boton SOS por WhatsApp

## Requisitos

- Node.js 18+

## Variables de entorno

Copia `.env.example` a `.env` y completa:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` (opcional)

## Ejecutar

```bash
npm install
npm run dev
```

## Firestore Rules recomendadas

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/contacts/{contactId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Deploy en Vercel

1. Sube repo a GitHub.
2. Importa el repo en Vercel.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Agrega las mismas variables `VITE_FIREBASE_*` en Vercel Project Settings.
6. Deploy.

## Nota

- Si no configuras Firebase, la app sigue funcionando con `localStorage`.
- Para sincronizacion real entre dispositivos, debes iniciar sesion con Google.