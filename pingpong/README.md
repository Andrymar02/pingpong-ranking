# 🏓 Ping Pong Ranking

Una web app per tenere la classifica ELO di ping pong tra colleghi, sia in singolo sia in doppio.
Si può installare sul telefono come un'app vera e non ha bisogno di un server: i dati stanno in un file JSON (`data/data.json`) nel tuo repository GitHub e ogni partita salvata diventa un commit, quindi hai anche lo storico completo.

## Funzioni
- Classifica **Singolo** e **Doppio** separate, con medaglie, vittorie/sconfitte, ultime 5 partite e ultima variazione
- **Nuova partita**: set per set (es. 11-7, 9-11, 11-4), data, flag **💨 Vento** e anteprima dei punti ELO prima di salvare
- Storico partite con la variazione di ogni giocatore, e possibilità di eliminare una partita
- Scheda giocatore con statistiche, serie positiva/negativa e grafico dell'andamento
- Aggiunta, rinomina e archiviazione dei giocatori
- Parametri ELO modificabili e backup/import in JSON
- Funziona offline in sola lettura (mostra gli ultimi dati scaricati)

## Come si calcola il punteggio
Ognuno parte da 1500. Dopo ogni partita:

```
variazione = K × scarto × vento × (risultato − probabilità attesa)
```

| Elemento | Default | Significato |
|---|---|---|
| K provvisorio | 48 | per le prime 10 partite, così la classifica si assesta in fretta |
| K | 32 | dopo le prime 10 partite |
| Scarto | 1 – 1.5× | `1 + 0.5 × (diff. punti / punti totali)`: un 11-2 pesa più di un 12-10 |
| Vento | × 0.5 | con il flag 💨 si vincono e si perdono la metà dei punti |
| Doppio | — | conta la media ELO della coppia ed entrambi i compagni ricevono la stessa variazione |

La classifica viene **ricalcolata ogni volta da tutto lo storico**. Per questo cancellare una partita o cambiare un parametro dà sempre un risultato coerente.

---

## Installazione (circa 10 minuti)

### 1. Crea il repository
1. Su GitHub crea un nuovo repository, ad esempio `pingpong-ranking`, **pubblico**.
2. Carica tutti i file di questa cartella: *Add file → Upload files*, trascina tutto e fai *Commit*.

### 2. Attiva GitHub Pages
*Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save*.
Dopo circa un minuto l'app sarà su `https://TUO-UTENTE.github.io/pingpong-ranking/`.

### 3. Crea un token per salvare i dati
*Il tuo avatar → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token*
- **Repository access**: *Only select repositories*, scegli solo `pingpong-ranking`
- **Permissions → Repository permissions → Contents**: *Read and write*
- Scadenza: quella che preferisci (alla scadenza basta generarne uno nuovo)

### 4. Collega l'app
Apri l'app e vai su **⚙️ Impostazioni**. Inserisci utente, repository (`pingpong-ranking`) e token, poi premi **Salva e collega**.

### 5. Condividi con i colleghi
Sempre in Impostazioni c'è **🔗 Link per colleghi**: genera un link che configura l'app in automatico, token compreso. Mandalo in privato al gruppo, non pubblicarlo.

### 6. Aggiungi alla schermata Home
- **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*
- **Android (Chrome)**: menu ⋮ → *Installa app* / *Aggiungi a schermata Home*

---

## Note sulla sicurezza e sulla privacy
- Il token permette **solo** di scrivere in quel repository. Nel caso peggiore qualcuno può modificare la classifica, ma lo storico dei commit permette sempre di tornare indietro.
- Con il repository pubblico, chiunque abbia il link può **vedere** classifica e nomi.
  Se volete tenerli privati, mettete i dati in un **secondo repository privato** (es. `pingpong-data`) e indicate quello nelle Impostazioni: l'app resta su Pages dal repo pubblico, mentre i dati sono leggibili solo da chi ha il token.
- Se due persone salvano nello stesso momento, l'app rilegge l'ultima versione e riprova da sola, così nessuna partita va persa.

## Modalità locale
Senza configurare GitHub l'app funziona lo stesso, ma salva i dati solo nel browser di quel telefono. È utile per provarla prima di collegarla.

## Struttura
```
index.html      pagina dell'app
style.css       stile (tema scuro, mobile-first)
app.js          logica: ELO, interfaccia, salvataggio su GitHub
sw.js           service worker (installabile + offline)
manifest.json   manifest PWA
icons/          icone dell'app
data/data.json  il "database"
```
