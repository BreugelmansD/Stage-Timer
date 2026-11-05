# Stage Timer · BLUE MOON

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

Op de Mac gebruik je de [Mac-app](#mac-app). Op andere computers (of vanuit de broncode) heb je alleen
[Node.js](https://nodejs.org) nodig (versie 18 of nieuwer), zonder extra pakketten.

## Mac-app

Stage Timer bestaat ook als gewone Mac-app (Apple Silicon én Intel, macOS 12 of nieuwer).
Je hebt dan **geen Node.js** nodig.

### Installeren

1. Download `Stage-Timer-mac.dmg`: op GitHub onder **Actions → Mac-app bouwen** → de laatste run →
   *Artifacts* (of onder **Releases** als er een versie uitgebracht is). Je kunt de app ook zelf
   bouwen, zie [Bouwen](#bouwen).
2. Open de .dmg en sleep **Stage Timer** naar **Apps**.
3. De eerste keer openen: de app is niet bij Apple geregistreerd, dus macOS waarschuwt.
   - Rechtsklik op Stage Timer in Apps → **Open** → **Open**, of
   - (macOS 15 en nieuwer) probeer te openen, ga naar **Systeeminstellingen → Privacy en beveiliging**
     en klik onderaan op **Open toch**.
   - Alternatief in Terminal: `xattr -dr com.apple.quarantine "/Applications/Stage Timer.app"`
4. Vraagt macOS of Stage Timer het lokale netwerk mag gebruiken of verbindingen mag ontvangen?
   Kies **Sta toe**, anders kunnen andere toestellen niet verbinden.

### Gebruiken

- De bediening opent meteen in een eigen venster.
- **Scherm → Open scherm** (⌘D) opent de klok. Is er een projector of tweede scherm aangesloten, dan
  verschijnt de klok daar in volledig scherm. ⌘⇧D verplaatst hem naar het volgende beeldscherm.
- **Netwerk → Adressen…** (⌘N) toont de adressen voor andere computers, tablets en telefoons.
- **Stage Timer → Instellingen…** (⌘,): poort en pincode. Is de poort bezet, dan neemt de app de
  volgende vrije poort en meldt dat.
- Zolang de klok open staat gaat het scherm van de Mac niet in slaap.
- Sluit je de vensters, dan blijft de app actief (bedienen via het netwerk blijft werken); stoppen met ⌘Q.
- Timers en instellingen staan in `~/Library/Application Support/Stage Timer/`
  (menu **Help → Gegevensmap tonen in Finder**).

### Bouwen

De .dmg wordt gebouwd door GitHub Actions op een Mac (workflow `.github/workflows/mac-app.yml`):

- **Handmatig:** tabblad **Actions → Mac-app bouwen → Run workflow**. De .dmg staat daarna bij de run
  onder *Artifacts* (30 dagen bewaard).
- **Als release:** verhoog `version` in `package.json`, maak een tag (bv. `git tag v1.1.0 && git push --tags`);
  de .dmg komt dan bij **Releases**.

Op een Mac met [Node.js](https://nodejs.org), in de map van de app: `npm install` en daarna `npm run dist:mac`.
De app staat dan in `dist/mac-universal/Stage Timer.app`; sleep hem naar Apps.

Lokaal testen zonder te bouwen: `npm install` en `npm run app`.

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

### Poort en andere opties

Standaard draait de app op poort **3000**. Een andere poort kies je zo:

| Hoe | Voorbeeld |
| --- | --- |
| Startbestand | Open `start-windows.bat` of `start-mac.command` in een teksteditor en pas `PORT=3000` bovenaan aan |
| Kort | `node server.js 8080` |
| Met opties | `node server.js --port 8080 --pin 4321` |

Alle opties (als argument of als omgevingsvariabele):

| Argument | Omgevingsvariabele | Standaard | Betekenis |
| --- | --- | --- | --- |
| `--port` | `PORT` | `3000` | Poort van de server |
| `--host` | `HOST` | `0.0.0.0` | Luisteradres (`127.0.0.1` = enkel deze computer) |
| `--pin` | `STAGE_TIMER_PIN` | – | Pincode die nodig is om te bedienen (het scherm blijft vrij te bekijken) |
| `--data` | `DATA_DIR` | `./data` | Map waarin de toestand bewaard wordt |

Is de poort al in gebruik, dan zegt de app dat en stelt een andere voor.
Meerdere timers op één laptop (bv. twee zalen)? Start de app twee keer met een andere poort én datamap:
`node server.js 3000` en `node server.js 3001 --data ./data-zaal2`.

### Zonder internet / zonder wifi

De app heeft **geen internet nodig**: alles (ook het lettertype en het logo) zit in de app zelf.
Er is wel een lokaal netwerk nodig tussen de host en de bediening. Dat kan op verschillende manieren:

- **Netwerkkabel via een switch of router.** Werkt zonder wifi en zonder internet.
- **Rechtstreekse netwerkkabel** tussen twee laptops. Na een halve minuut krijgen beide een adres in de
  vorm `169.254.x.x`; de host toont dat adres bij het opstarten en onder **🌐 Netwerk**.
- **Eigen (reis)router**, met of zonder wifi. Aanrader op events: gastennetwerken laten toestellen vaak
  niet met elkaar praten.
- **Hotspot** van de host-laptop.

Heb je geen netwerk, dan kun je het scherm en de bediening ook allebei op de host-laptop openen
(bv. de bediening op het laptopscherm en het scherm op de projector).

### Updaten

Haal je de app van GitHub met git, dan volstaat in de map van de app:

```bash
git pull
```

en de app opnieuw starten. Je timers en instellingen (map `data/`) blijven bewaard.
Een opgeslagen weergave blijft zoals ze was; klik onder **Weergave** op *Standaardweergave herstellen*
om de nieuwe standaardstijl te krijgen.

### Huisstijl

De bediening gebruikt de BLUE MOON-huisstijl (petrolblauw `#004255`, Montserrat, logo). Op het scherm
is Montserrat de standaardletter en kun je het logo aanzetten onder **Weergave → BLUE MOON-logo**.
Logo en lettertype staan in `public/brand/`; Montserrat valt onder de SIL Open Font License
(`public/brand/fonts/OFL.txt`).

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

**❓ Help** (rechtsboven) toont deze uitleg ook in de app zelf, met de juiste netwerkadressen. Bij het eerste bezoek opent de uitleg automatisch.

**Sneltoetsen** (in de bediening): `spatie` start/pauze · `→` volgende · `←` vorige · `R` reset ·
`+`/`-` één minuut erbij/eraf · `B` blackout · `M` bericht tonen/verbergen · `?` help.

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
public/brand/          logo, favicon en Montserrat (huisstijl)
electron/              Mac-app (venster, menu, instellingen)
build/icon.png         app-icoon
```

De server is de enige bron van waarheid. Elke browser ontvangt de volledige toestand via
Server-Sent Events en rekent de resterende tijd zelf uit met een gesynchroniseerde klok, zodat alle
schermen exact gelijk lopen, ook als de klokken van de computers niet gelijk staan.
