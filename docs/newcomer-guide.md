# Rakathon: průvodce pro nové účastníky

Přihlaste se týmovým účtem, zkopírujte si API klíč a vyzkoušejte první volání modelu.

**Portál pro účastníky:** <https://aka.ms/rakathon2026>

[![Naskenujte QR kód a otevřete portál pro účastníky](assets/images/participant-portal-qr.png)](https://aka.ms/rakathon2026)

Naskenujte QR kód nebo otevřete URL výše a přihlaste se přiděleným týmovým účtem.

**Prezentace:** otevřete [newcomer-guide.standalone.html](newcomer-guide.standalone.html) v prohlížeči a zvolte **Prezentace**. Stejný soubor obsahuje i úplného průvodce pro čtení a funguje offline. Pro otevření portálu nebo volání Azure potřebujete připojení k internetu.

## Co může váš tým využít

| Prostředek | Co vám poskytne | Kde začít |
|---|---|---|
| Portál pro účastníky | Týmový API klíč, názvy deploymentů modelů, URL gateway a seznam datových souborů | Portál pro účastníky výše |
| AI gateway | Sdílené modely pro text a kód i deployment pro generování obrázků; přístup přes týmový klíč | Portál: **Váš API klíč** a **Modely** |
| Data k výzvám | Datové soubory pro výzvy VZP, pouze pro čtení | Portál: **Datové podklady pouze pro výzvy VZP** |
| Týmové prostředí | Azure resource group `rg-teamNN`, kde má tým roli Contributor | <https://portal.azure.com/>: **Resource groups** |

`teamNN` označuje váš přidělený tým, například `team01`. Týmové prostředí není samostatná subscription: spravujte pouze vlastní resource group. Týmy nemají přímý přístup do portálu Microsoft Foundry ani ke službě Agent Service.

Seznamy modelů a souborů jsou snapshoty: v portálu zkontrolujte datum **Stav k**. Průvodce vychází z konfigurace repozitáře ověřené 12. října 2026; nejde o živý přehled ani záruku dostupnosti.

![Portál pro účastníky s navigací k týmovému API klíči, modelům a datům pro výzvy VZP](assets/images/participant-portal.png)

Screenshot portálu dodaný pro tohoto průvodce má skryté identifikátory účtu a tenantu. Ukázka používá jiný než týmový účet, proto nezobrazuje API klíč. Vlastní klíč uvidíte po přihlášení přiděleným týmovým účtem.

## Jak získáte týmový účet: tištěná kartička

Organizátoři plánují předat každému týmu fyzickou kartičku ve formátu vizitky. Vlevo bude **UPN** (celé přihlašovací jméno týmu) a **TAP** (Temporary Access Pass), vpravo QR kód odkazující na <https://aka.ms/rakathon2026>.

![Ukázková vizitka: vlevo fiktivní UPN team01@example.invalid a neplatný TAP UKAZKA-NEPLATI, vpravo QR kód portálu pro účastníky](assets/images/team-access-card-example.png)

Ilustrační vizitka v poměru **90 × 50 mm**, nikoli finální tiskový podklad. **UPN i TAP jsou fiktivní a neplatné.** QR kód skutečně otevírá portál pro účastníky.

1. U organizátorů převezměte kartičku svého týmu a ověřte, že vám patří. Ukázkové údaje z tohoto průvodce nepoužívejte.
2. Naskenujte QR kód. Otevře pouze portál, nepřihlásí vás automaticky a neobsahuje UPN ani TAP. Při přihlášení k Microsoftu zadejte celé UPN z kartičky a použijte její TAP.
3. Kartičku chraňte: obsahuje přihlašovací údaje. Nefotografujte ji pro veřejné sdílení, nedávejte ji do Gitu ani veřejného chatu. Platnost TAP si ověřte u organizátorů; při ztrátě kartičky nebo nefunkčním TAP je kontaktujte.

TAP není API klíč. Týmový API klíč si zkopírujete až po přihlášení v sekci **Váš API klíč**. Soukromý soubor `teamNN.md`, pokud vám jej organizátoři poskytnou, může sloužit jako záložní předání údajů.

## Přihlaste se účtem od organizátorů

1. Připravte si týmovou kartičku s UPN a TAP a ověřte si platnost TAP. Pokud dostanete i záložní soubor `teamNN.md`, uchovávejte ho stejně bezpečně jako kartičku; nedávejte ho do Gitu ani nesdílejte mimo tým.
2. Naskenujte QR z kartičky nebo otevřete <https://aka.ms/rakathon2026>. Pokud jste u Microsoftu již přihlášeni osobním nebo pracovním účtem, použijte samostatný profil prohlížeče nebo anonymní okno.
3. Zadejte celé UPN z kartičky, nikoli svůj běžný účet. Při přihlášení k Microsoftu použijte TAP a postupujte podle případných pokynů k nastavení ověřování.
4. V portálu zkontrolujte přihlášeného uživatele. Klíč musí patřit stejnému týmu `teamNN`.

TAP slouží k přihlášení k Microsoftu; **není to** API klíč pro modely. Funguje pouze v době platnosti potvrzené organizátory a může být jednorázový. Pokud vypršel, ještě neplatí, byl již použit nebo nelze přihlášení dokončit, požádejte organizátory o pomoc.

## Zkopírujte si týmový klíč

1. Otevřete sekci **Váš API klíč**.
2. Zkontrolujte správný tým a stav **aktivní**.
3. Klikněte na ikonu kopírování u **API klíč (hlavička api-key)**. Ikona oka hodnotu zobrazí nebo skryje.
4. Zkopírujte **Base URL (OpenAI v1)**. V sekci **Modely** rozbalte kartu modelu a zkopírujte **Deployment / model v SDK**.

Stejný týmový klíč funguje pro všechny deploymenty modelů na gateway. Uložte jej jako lokální secret, proměnnou prostředí nebo do serverového úložiště tajných údajů aplikace. Nikdy jej necommitujte, nevkládejte do veřejného chatu, neukazujte na screenshotech ani nezapisujte do kódu v prohlížeči. Pokud portál klíč nenačte, požádejte organizátory o pomoc nebo použijte záložní API údaje ze soukromého předávacího souboru, pokud jej máte. TAP z kartičky API klíč nenahrazuje.

Gateway má adresu `https://apim-rakathon-q7146n.azure-api.net/openai/v1`. Klíč posílejte v **hlavičce `api-key`**; samotná hlavička `Authorization: Bearer` požadavky na gateway neověří. Nepoužívejte přímý endpoint Foundry.

## Vyzkoušejte krátké první volání modelu

V sekci **Modely** vyberte textový deployment. Hodnota `model` je **název deploymentu**, nikoli zobrazovaný název modelu. Například pro `gpt-6-luna` je nakonfigurován deployment `gpt-6-luna-dz-eu`; před použitím ověřte, že je v seznamu.

Příklad spusťte v **Bashi** s nainstalovaným `curl`. Zadávání klíče je skryté a jeho konkrétní hodnota se neuloží do historie příkazů:

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
read -r -s -p "Týmový API klíč: " API_KEY; printf '\n'
export API_KEY
curl --fail-with-body --silent --show-error \
  https://apim-rakathon-q7146n.azure-api.net/openai/v1/chat/completions \
  -H "api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-luna-dz-eu","messages":[{"role":"user","content":"Pozdrav náš tým na hackathonu."}]}'
unset API_KEY
```

Úspěšný požadavek vrátí JSON s odpovědí asistenta. Pokud jste vybrali jiný textový deployment, změňte hodnotu `model`.

Pro Python nainstalujte do prostředí projektu balíček `openai` a použijte skryté zadávání klíče:

```python
from getpass import getpass
from openai import OpenAI

client = OpenAI(
    base_url="https://apim-rakathon-q7146n.azure-api.net/openai/v1/",
    api_key="unused",
    default_headers={"api-key": getpass("Týmový API klíč: ")},
)
reply = client.chat.completions.create(
    model="gpt-6-luna-dz-eu",
    messages=[{"role": "user", "content": "Pozdrav náš tým na hackathonu."}],
)
print(reply.choices[0].message.content)
```

SDK vyžaduje parametr `api_key`; hodnota `"unused"` je pouze placeholder, nikoli přihlašovací údaj. Skutečný klíč gateway patří do `default_headers`.

Konfigurace zahrnuje modely OpenAI, xAI, DeepSeek, Moonshot AI / Kimi a Microsoft AI. Generování obrázků používá `/images/generations`, nikoli `/chat/completions`. Ne každý model podporuje všechna API a parametry. Podle označení **EU Data Zone** nebo **Global** vyberte rozsah zpracování povolený pro vaši výzvu. U Global nelze předpokládat zpracování pouze v Evropě.

## Stáhněte si data k výzvě přes Azure Portal

Portál obsahuje data pro **výzvy VZP**. Používejte je pouze tehdy, pokud se týkají vaší výzvy a máte jejich použití povolené.

1. V sekci **Datové podklady pouze pro výzvy VZP** zvolte **Otevřít storage v portálu**.
2. Do Azure Portal se přihlaste stejným týmovým účtem. V případě potřeby přepněte adresář na adresář akce uvedený organizátory.
3. Otevřete storage account `strakathondataq7146n`, poté **Containers / Kontejnery** > **data**.
4. Použijte ověřování **Microsoft Entra ID**, vyberte soubor a zvolte **Download / Stáhnout**.

Snapshot repozitáře z 9. října obsahuje `Rakathon_Datove_rozhrani.docx`, `Rakhaton2026.csv` a `Rakhaton2026.zip`. Aktuální publikovaný snapshot ověřte v seznamu souborů v portálu.

Portál pro účastníky nestahuje soubory ani negeneruje odkazy ke stažení. Přístup k datům v Azure je oddělený od přihlášení do portálu: vyžaduje role Reader a Storage Blob Data Reader i povolený síťový přístup k úložišti. Pokud přístup nefunguje, požádejte organizátory o kontrolu oprávnění i sítě. Nežádejte o klíče storage accountu ani neměňte nastavení sdíleného úložiště.

## Vyvíjejte ve vlastní týmové resource group

Na <https://portal.azure.com/> otevřete **Resource groups** a vyberte přidělenou `rg-teamNN`. Tým zde má roli Contributor, která umožňuje vytvářet a spravovat prostředky aplikace v této skupině v mezích Azure policies a dostupných kvót. Sdílená data jsou pouze pro čtení a skupiny ostatních týmů nejsou součástí vašeho prostředí.

Sdílená AI gateway je připravena k použití; kvůli volání modelů nemusíte nasazovat vlastní Foundry resource. Před vytvářením placených prostředků se domluvte s týmem a u organizátorů ověřte povolené služby a náklady na infrastrukturu. Níže uvedený rozpočet modelového API není rozpočtem na libovolné prostředky Azure.

## Začněte krátkými voláními a včas požádejte o pomoc

Výchozí konfigurace repozitáře počítá s **1 000 USD na tým** pro používání modelů, upozorněním organizátorů při **90 %** a pozastavením přístupu po dosažení týmového limitu. Sdílený limit celé akce může zastavit všechny týmy dříve. Výchozí kvóta je **4 miliony tokenů na tým a den**, společná pro textové modely. Jde o výchozí nastavení, nikoli aktuální zůstatek; skutečný příděl a spotřebu potvrzují organizátoři.

Začněte krátkými prompty a malým počtem souběžných požadavků. Při chybách zastavte opakované pokusy ve smyčce. Po překročení rate limitu vyčkejte a respektujte `Retry-After`, pokud je uveden. Pozastavený přístup mohou obnovit pouze organizátoři.

| Problém | Co zkontrolovat |
|---|---|
| Přihlášení k Microsoftu nefunguje | Celé týmové přihlašovací jméno, platnost a jednorázovost TAP; zda prohlížeč nevybral jiný účet |
| Portál uvádí, že účet není týmový | Odhlaste se a použijte přidělený účet `teamNN` |
| Klíč se nenačítá | Zkuste načtení či přihlášení znovu; informujte organizátory nebo použijte záložní API údaje z předávacího souboru, pokud jej máte. TAP není API klíč |
| HTTP 401 z modelové gateway | Hlavička `api-key`, zkopírovaný klíč, URL gateway a aktivní stav týmu; pozastavení také vrací 401 |
| **zablokováno - rozpočet** / suspended | Kontaktujte organizátory; nový klíč pozastavený přístup neobnoví |
| HTTP 404 nebo nepodporovaný model či parametr | Přesný název deploymentu a API vhodné pro daný model |
| HTTP 429 | Rate limit, sdílená kapacita deploymentu nebo kvóta tokenů; vyčkejte místo opakování ve smyčce |
| Zamítnutý přístup ke storage | Správný účet a adresář, role Reader a Blob Data Reader a povolená síť |
| Katalog se nenačítá nebo vypadá zastarale | Požádejte organizátory o kontrolu exportu katalogu a nasazení portálu |

K žádosti o pomoc přiložte název týmu, prováděnou akci nebo cestu endpointu, název deploymentu, HTTP status, čas a chybovou zprávu bez citlivých údajů. **Nikdy neposílejte TAP ani API klíč.**

**Můžete začít:** správný týmový účet, aktivní klíč gateway a jedno úspěšné volání modelu.

### Zdroje konfigurace

Fungování pro účastníky: [zdrojový kód portálu](../web/src/main.ts), [příklady použití API klíče](../web/src/key.ts), [vytváření týmových účtů](../infra/rakathon-env/scripts/create-team-users.sh) a [přehled infrastruktury](../infra/rakathon-env/README.md). Snapshot modelů a souborů: [katalog](../web/public/catalog.json), export z 9. října 2026. Výchozí rozpočty: [řízení nákladů](../infra/rakathon-env/docs/cost-control.md) a [proměnné](../infra/rakathon-env/shared/variables.tf), ověřeno 12. října 2026. Tyto zdroje v repozitáři spravují organizátoři; účastníci nemusí spouštět provisioning skripty.
