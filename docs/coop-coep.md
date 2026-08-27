# COOP/COEP headers

The two headers the synchronous API needs, per-host configuration, and the service-worker workaround for hosts that cannot send them.

← Back to the [readme](../readme.md).

---

## COOP/COEP Headers

To enable the sync API, your page must be `crossOriginIsolated`. Add these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, only the async (`promises`) API is available.

### When you cannot set headers at all

Static hosts like GitHub Pages send no custom headers, which normally rules the sync API out. A
service worker can add them on the way back instead — it sits in front of every request in its
scope, and the browser treats the headers exactly as if the server had sent them.

[`demo/coi-serviceworker.js`](../demo/coi-serviceworker.js) is a working, commented implementation;
Copy the file, load it before anything else, and the first visit
registers it and reloads once:

```html
<script src="/coi-serviceworker.js"></script>
```

Two things to know before shipping it: the one-time reload on first load is unavoidable (isolation
is decided when the document is created), and `require-corp` means cross-origin subresources must
opt in via CORP/CORS — that is a property of isolation itself, not of the workaround.

### Vite

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### Express

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

### Vercel

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

### Runtime Check

```typescript
if (crossOriginIsolated) {
  // Sync + async APIs available
  fs.writeFileSync('/fast.txt', 'blazing fast');
} else {
  // Async API only
  await fs.promises.writeFile('/fast.txt', 'still fast');
}
```
