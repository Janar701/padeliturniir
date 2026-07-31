# Padeliturniir

Lihtne brauseripõhine äpp padeliturniiride korraldamiseks: seaded, mängijad, automaatne õiglane ajakava (ring või Americano), skooride sisestus, pingerida ja play-off parimate vahel.

## Kohalik käivitamine (testimiseks oma arvutis)

Äppi ei saa lihtsalt topeltklõpsuga avada (brauserid blokeerivad mooduli-JS faili:// aadressilt).

- **Kõige lihtsam:** topeltklõpsa kaustas failil `Start.bat` — see käivitab serveri ja avab brauseri automaatselt.
- **Käsurealt:** `python -m http.server 8000` ja ava `http://localhost:8000`.

See kohalik käivitamine on hea testimiseks, aga **jagamislingid ei tööta teistele inimestele**, kui äppi ei ole seadistatud vastavalt allpool kirjeldatule.

## Jagamine teistele — Firebase seadistamine

Selleks et "Jaga link" töötaks kõigile, kõikjal (mitte ainult sinu WiFi-võrgus) ja uueneks kõigil automaatselt, kasutab äpp tasuta Google Firebase reaalajas andmebaasi (Firestore). Kuni see on seadistamata, näitab äpp jagamisnupu vajutamisel selgitust ja jagamine ei tööta — kõik muu (ajakava, skoorid, play-off) töötab niikuinii, ainult lokaalselt.

### 1. Loo Firebase projekt

1. Mine [console.firebase.google.com](https://console.firebase.google.com) ja logi sisse oma Google kontoga.
2. Klõpsa **"Add project"** (Lisa projekt). Anna nimeks nt `padeliturniir`. Google Analytics võid välja lülitada (pole vaja).
3. Kui projekt on loodud, vasakul menüüs vali **Build > Firestore Database**.
4. Klõpsa **"Create database"**. Vali endale sobiv regioon (nt `eur3 (europe-west)`). Vali **"Start in production mode"**.

### 2. Sea turvareeglid

Firestore Database lehel klõpsa üleval **"Rules"** tab ja asenda sisu järgnevaga, seejärel **"Publish"**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tournaments/{tournamentId} {
      allow read, write: if true;
    }
  }
}
```

**Oluline aus märkus turvalisuse kohta:** need reeglid on meelega lihtsad — igaüks, kes teab (või ära arvab) turniiri ID-d, saab seda ka muuta, mitte ainult vaadata. Kaitse tugineb sellele, et turniiri ID on juhuslik ja praktiliselt äraarvamatu string (samasugune usaldusmudel nagu "kõik lingiga saavad muuta" Google Docsis). See sobib hästi sõprade/kogukonna turniiri jaoks, aga ära kasuta seda tundliku info jaoks.

### 3. Registreeri veebirakendus ja kopeeri seadistus

1. Vasakul menüüs klõpsa hammasratast **"Project settings"** juures.
2. Alla kerides **"Your apps"** all klõpsa **"</>"** (Web) ikooni.
3. Anna rakendusele nimi (nt `padeliturniir-web`) ja klõpsa **"Register app"**. **Ära** märgi "Also set up Firebase Hosting" (kasutame selle asemel GitHub Pagesit).
4. Kopeeri kuvatav `firebaseConfig` objekt (näeb välja nagu allpool).
5. Ava fail [js/firebase-config.js](js/firebase-config.js) ja kleebi väärtused sinna, asendades kõik `PASTE_...` kohatäitjad:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "padeliturniir-xxxxx.firebaseapp.com",
  projectId: "padeliturniir-xxxxx",
  storageBucket: "padeliturniir-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef",
};
```

Salvesta fail. Kui käivitad äppi nüüd uuesti (`Start.bat` või `python -m http.server`), peaks "Jaga link" nupp hakkama näitama kahte linki (vaatamiseks ja toimetamiseks) selle asemel, et öelda "pole seadistatud".

## Avalik majutamine — GitHub Pages

Firebase lahendab andmete jagamise, aga äpi enda failid (HTML/CSS/JS) peavad samuti olema kättesaadavad avalikult, muidu ei saa keegi teine linki üldse avada. Kõige lihtsam tasuta variant on GitHub Pages:

1. Mine [github.com](https://github.com), logi sisse (või loo tasuta konto, kui pole veel).
2. Klõpsa üleval paremal **"+"** > **"New repository"**. Anna nimeks nt `padeliturniir`, vali **Public**, klõpsa **"Create repository"**.
3. Uue repo lehel klõpsa **"uploading an existing file"** (või **Add file > Upload files**).
4. Lohista sinna kõik selle kausta failid ja alamkaustad (`index.html`, `style.css`, `js/` kaust koos kõigi failidega). `Start.bat` ega `README.md` ei ole hostimiseks vajalikud, aga ei sega ka.
5. Klõpsa **"Commit changes"**.
6. Mine repo **Settings > Pages**.
7. **"Build and deployment"** all vali **Source: Deploy from a branch**, **Branch: main**, kaust **/ (root)**, klõpsa **Save**.
8. Oota pool minutit — GitHub näitab lehe ülaosas linki kujul `https://<sinu-kasutajanimi>.github.io/padeliturniir/`. See ongi äpi püsiv, avalik aadress.

Sellest hetkest ava äppi alati selle GitHub Pages lingi kaudu (mitte `localhost`) — siis töötavad jagamislingid ("Jaga link" nupu alt) kõigile, kõikjal, ja uuenevad automaatselt.

**Kui muudad hiljem koodi** (nt see äpp uueneb): laadi muudetud failid samasse GitHub reposse üles uuesti (Add file > Upload files, vali muudetud failid) — Pages uueneb automaatselt mõne hetke pärast.

## Kuidas jagamine täpselt töötab

- **👁️ Vaatamise link** — avaja näeb ajakava, skoore ja pingerida reaalajas, aga ei saa midagi muuta.
- **✏️ Toimetamise link** — avaja saab ka skoore sisestada, täpselt nagu sina ise. Sobib nt teisele korraldajale või väljakul olevale abilisele.
- Mõlemad lingid uuenevad **automaatselt** kõigil, kellel need parasjagu avatud on (punane "🔴 Otseülekanne" märk ülal näitab, et see töötab).
- Ilma Firebase'i seadistuseta töötab äpp endiselt täiesti normaalselt — lihtsalt jagamine puudub ja kõik jääb sinu enda brauserisse.

## Andmete salvestamine

- Kõik sinu loodud turniirid on nähtaval "Minu turniirid" nimekirjas ainult sinu enda brauseris (`localStorage`).
- Kui Firebase on seadistatud, salvestatakse iga turniiri täielik seis ka pilve — sealt loevad ja kirjutavad kõik, kellel jagamislink on.
