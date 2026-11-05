# Stage Timer

Een stage timer die je via het netwerk bedient. De **host** (de computer die het scherm uitstuurt
naar een monitor of projector) draait een kleine server. Vanaf elke andere computer, tablet of
telefoon op hetzelfde netwerk stuur je de timer aan via de browser.

- ⏱ **Meerdere timers**: aftellen, optellen (stopwatch), aftellen tot een tijdstip, of de huidige tijd
- 🖥 **Aanpasbare klok**: lettertype, dikte, grootte, notatie, kleuren, waarschuwingskleuren, voortgangsbalk,
  titel, huidige tijd, volgende onderdeel, spiegelen, …
- 💬 **Tekst meesturen** naar het scherm: onderaan, bovenaan of groot in het midden, met optioneel knipperen,
  plus snelberichten met één klik
- 📄 **Script inladen** (Word, Excel, CSV, tekst): de app haalt de timers er automatisch uit
- 🌐 **Bediening via het netwerk**, met meerdere bedieningen en schermen tegelijk, altijd synchroon
- 🔒 Optionele **pincode** voor de bediening
- 💾 Alles wordt automatisch bewaard (ook na een herstart)

Geen installatie van extra pakketten nodig: alleen [Node.js](https://nodejs.org) (versie 18 of nieuwer).

## Starten

```bash
node server.js
```

Of dubbelklik op `start-windows.bat` (Windows) of `start-mac.command` (macOS).

De server toont de adressen:

```
 Op deze computer:   bediening  http://localhost:3000/
                     scherm     http://localhost:3000/display
 Via het netwerk:    bediening  http://192.168.1.20:3000/
                     scherm     http://192.168.1.20:3000/display
```

### Typische opstelling

1. Start de server op de **host**: de computer die aan de monitor of projector op het podium hangt.
2. Open op de host `http://localhost:3000/display` in een browser, sleep het venster naar het
   podiumscherm en druk op **F** (of dubbelklik) voor volledig scherm.
3. Open op je **bedieningscomputer** (of tablet/telefoon) `http://<ip-van-host>:3000/`.
   Klik in de bediening op **🌐 Netwerk** om de juiste adressen te zien en te kopiëren.

Je kunt zoveel schermen en bedieningen openen als je wilt; ze tonen allemaal hetzelfde.

> **Windows-firewall:** de eerste keer vraagt Windows of Node.js toegang mag krijgen tot het netwerk.
> Kies *Toestaan* voor privénetwerken, anders kunnen andere computers niet verbinden.

### Opties

| Omgevingsvariabele | Standaard | Betekenis |
| --- | --- | --- |
| `PORT` | `3000` | Poort van de server |
| `HOST` | `0.0.0.0` | Luisteradres (`127.0.0.1` = enkel deze computer) |
| `STAGE_TIMER_PIN` | – | Pincode die nodig is om te bedienen (het scherm blijft vrij te bekijken) |
| `DATA_DIR` | `./data` | Map waarin de toestand bewaard wordt |

Voorbeeld: `STAGE_TIMER_PIN=4321 PORT=8080 node server.js`
(Windows PowerShell: `$env:STAGE_TIMER_PIN="4321"; node server.js`)

## Bediening

**Live-paneel**

- ▶ Start / ⏸ Pauze, ⏮ vorige, ⏭ volgende, ↺ reset
- −1 min / −10 s / +10 s / +1 min: tijd bijsturen terwijl de timer loopt
- ⬛ Blackout: scherm meteen op zwart
- Live voorbeeld van wat er op het scherm staat
- Notities van de actieve timer (bv. scripttekst) voor de regie

**Timers**

- Klik op een timer om hem te laden, ▶ om hem meteen te starten
- ✎ bewerken (of dubbelklik), ⧉ dupliceren, ✕ verwijderen, ↑↓ of slepen om te herschikken
- Per timer: titel, soort, duur, waarschuwingstijd (geel), bijna-op-tijd (rood), notities,
  starttijd in het draaiboek en *automatisch de volgende timer starten*
- Als de tijd op is telt de timer negatief verder (overtijd), optioneel knipperend
- ⤓ Exporteren bewaart de lijst als `.json`, die je later opnieuw kunt inladen

Bij **Volgende/Vorige** blijft de timer lopen als hij al liep (handig tijdens een show).

**Bericht**: typ een tekst en klik *Tonen op scherm* (of Ctrl+Enter). Snelberichten worden met één
klik getoond; je kunt er zelf toevoegen of verwijderen.

**Weergave**: alles aan het scherm aanpassen; wijzigingen zijn meteen zichtbaar.

**Sneltoetsen** (in de bediening): `spatie` start/pauze · `→` volgende · `←` vorige · `R` reset ·
`+`/`-` één minuut erbij/eraf · `B` blackout · `M` bericht tonen/verbergen.

## Script inladen

Klik op **📄 Script inladen**, kies een bestand (of sleep het erin, of plak de tekst). Je krijgt een
overzicht van alle gevonden timers; daar kun je titels en tijden nog aanpassen en onderdelen
uitvinken. Daarna kies je *Lijst vervangen* of *Toevoegen aan lijst*.

Ondersteunde bestanden: **.docx** (Word), **.xlsx** (Excel), **.csv/.tsv**, **.txt/.md** en **.json**.
Oudere formaten (.doc, .xls, .pdf, Pages) eerst opslaan als .docx/.xlsx, of de tekst kopiëren en plakken.

### Wat wordt herkend?

**Een duur in de tekst** – de rest van de regel wordt de titel:

```
Welkom door de presentator – 5 min
Speech burgemeester (05:00)
Band – 12'30"
Pauze 15 minuten
Prijsuitreiking 1u30
Duur: 4:00 Slotwoord
Workshop 2m30s
```

Notaties: `5 min`, `5 minuten`, `5'`, `90 sec`, `30"`, `2m30s`, `1u30`, `1h 30m`, `1,5 uur`, `mm:ss`, `u:mm:ss`.

**Een draaiboek met starttijden** – de duur is de tijd tot het volgende onderdeel:

```
19:30 Deuren open
20:00 Welkom
20:05 Speech
20:20 - 20:50 Band
21:00 Einde
```

Ook `20.15`, `20u15` en tijdsblokken als `20:00 - 20:15` of `20u00 tot 20u15` werken.
Voor het laatste onderdeel zonder eindtijd vul je zelf een duur in (standaard 5:00).

**Tabellen** (Excel, CSV, Word-tabellen of geplakt uit Excel) met kolomkoppen zoals
*Titel/Onderdeel/Item*, *Duur/Lengte*, *Start/Aanvang*, *Einde* en *Notities/Opmerking/Spreker*.
Excel-tijdcellen (bv. `0:05:00` of `20:00`) worden correct gelezen.

Regels zonder tijd (bv. de eigenlijke scripttekst) worden als **notities** bij het voorgaande
onderdeel bewaard en verschijnen in het live-paneel van de bediening.

Voorbeelden staan in de map [`examples/`](examples/).

## Ontwikkeling

```bash
npm test     # tests voor de script-parser en de tijdberekening
```

Structuur:

```
server.js              HTTP-server, toestand, commando's, live updates (Server-Sent Events)
lib/script-parser.js   timers uit scripts halen (tekst, CSV, docx, xlsx, json)
lib/zip.js             minimale ZIP-lezer voor .docx/.xlsx
public/shared.js       tijd parsen/formatteren en timerberekening (server + browser)
public/client.js       verbinding met de server en kloksynchronisatie
public/control.*       bedieningspagina
public/display.*       schermpagina
```

De server is de enige bron van waarheid. Elke browser ontvangt de volledige toestand via
Server-Sent Events en rekent de resterende tijd zelf uit met een gesynchroniseerde klok, zodat alle
schermen exact gelijk lopen, ook als de klokken van de computers niet gelijk staan.
