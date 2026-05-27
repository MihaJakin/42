# Marathon 18.10.2026 — PWA aplikacija

Adaptivna spletna aplikacija za 20-tedenski maratonski trening plan (sub-4:00).
PWA = deluje offline, lahko jo dodaš na home screen telefona, **vsi podatki ostanejo lokalno** v brskalniku (IndexedDB).

## Funkcionalnosti

- **Teden** — prikaže sedanji teden plana s sejami, pace cilji, HR conami, opisi
- **Plan** — pregled vseh 20 tednov po fazah (Recovery → Build 1 → Build 2 → Peak → Taper)
- **Statistika** — skupni km, povprečni pace, tedenski volumen graf
- **Vnos treninga** — tap na sejo odpre formo: km, čas, HR, RPE, opomba
- **Adaptivnost** — pace cilji se prilagajajo glede na tvoje dejanske rezultate
  - Auto-recompute če povprečni easy tek odstopa >8 s/km od plana
  - Auto-recompute če vneseš nov race rezultat (Settings → "Nova race performance")
  - Auto-update max HR če vneseš večji peak HR
- **Export/Import JSON** — sync med napravami (shrani v privat GitHub gist ali iCloud)
- **Apple Health seed** — naloži svojo zgodovino 49 tekov v aplikacijo

## Hitri start (lokalno)

```bash
cd marathon-pwa
python -m http.server 8765
# odpri http://localhost:8765/ v brskalniku
```

V Nastavitvah klikni **"Naloži seed"** — uvozi zgodovino tekov iz Apple Health.

## Deploy na GitHub Pages

1. Naredi privat GitHub repo (npr. `marathon-2026`)
2. Skopiraj vsebino mape `marathon-pwa/` v koren repoja
3. Push:
   ```bash
   git init && git add . && git commit -m "init"
   gh repo create marathon-2026 --private --source=. --push
   ```
4. V GitHub: Settings → Pages → Source: `main` branch, root folder → Save
5. URL: `https://<tvoj-uporabnik>.github.io/marathon-2026/`

Na telefonu odpri ta URL → "Add to Home Screen" (iOS Safari ali Android Chrome).

## Sync med napravami (PC ↔ telefon)

Aplikacija namenoma **nima backenda** — vsi podatki so v `IndexedDB` brskalnika. Za sync:

1. Na napravi A: Nastavitve → **Export JSON** → naloži datoteko
2. Pošlji datoteko (email, Dropbox, gist, ...) na napravo B
3. Na napravi B: Nastavitve → **Import JSON** → izberi datoteko

**Tip**: avtomatski sync skozi privat GitHub gist:
- Shrani export JSON kot gist
- Ko želiš restore: copy raw URL, prilepi v JS console:
  ```js
  fetch("https://gist.../raw").then(r => r.json()).then(Store.importAll).then(() => location.reload())
  ```

## Datoteke

| Datoteka | Vsebina |
|---|---|
| `index.html` | UI shell, modal, layout |
| `styles.css` | AMEU brand palette, dark/light auto |
| `app.js` | Glavna logika, rendering, event handlers |
| `plan.js` | 20-tedenski skeleton, pace algoritmi, adaptivna logika |
| `store.js` | IndexedDB wrapper (stores: sessions, completed, settings, history) |
| `sw.js` | Service worker za offline cache |
| `seed.json` | Predhodna zgodovina 49 tekov iz Apple Health (jan-maj 2026) |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | App ikone (192, 512, SVG) |

## Tipi sej v planu

| Code | Label | Color | Pace ref |
|---|---|---|---|
| `easy` | Easy | zelena | 6:02-6:32/km |
| `recovery` | Recovery | svetlo zelena | 6:32-7:00/km |
| `long` | Long | AMEU modra | 5:52-6:22/km |
| `tempo` | Tempo | oranžna | 4:50-5:11/km |
| `mp` | MP (marathon pace) | vijolična | 5:31-5:45/km |
| `intervals` | Intervali | rdeča | 4:30-4:50/km |
| `race` | MARATON | rdeča | MP |

Cilji se preračunajo dinamično, če uporabnik spremeni `goalTimeSec` v nastavitvah.

## Resetiranje podatkov

Nastavitve → **"⚠ Resetiraj vse"** zbriše vse vnose. Nepovratno (razen če imaš export).

## Testirano

- Chromium (Playwright) — pass
- Lokalni python http.server — pass

Mobilne brskalnike (Safari, Chrome) testiraš sam. PWA naj bi delovala na iOS 14+ in Android 8+.

## Datum maratona / Cilj — kako spremenim?

V `plan.js` na vrhu:
```js
const PLAN_CONFIG = {
  startDate: "2026-06-01",
  raceDate:  "2026-10-18",
  goalMarathonTime: 4 * 3600,
  totalWeeks: 20,
};
```

Po spremembi: clear cache v brskalniku ali resetiraj IndexedDB.

---

**Built**: 27.05.2026. Vse vprašanja: [glej PLAN.md za utemeljitev plana](../PLAN.md).
