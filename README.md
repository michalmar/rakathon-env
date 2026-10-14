# rakathon-env

Participant onboarding: [team newcomer guide](docs/newcomer-guide.md).
The [standalone HTML guide](docs/newcomer-guide.standalone.html) also includes
a browser presentation: open it and select **Slides**.

Terraform prostředí pro Azure hackathon je v adresáři
[`infra/rakathon-env`](infra/rakathon-env/README.md).

Účastnický portál s modely, endpointy a přehledem dat je v
[`web`](web/README.md). Běží na Static Web Apps Standard s přihlášením pouze
do Rakathon tenantu a připojeným Azure Functions backendem pro týmové API klíče,
krátkodobé odkazy ke stažení dat a přehled nákladů pro účty mimo týmy.
Aktuální architekturu popisuje
[`architektonický diagram`](infra/rakathon-env/05_arch_diagram_update_result.html).

Veřejná architektura: [GitHub Pages](https://michalmar.github.io/rakathon-env/).
Pages publikuje větev `main` z kořene repository; `index.html` přesměruje
na aktuální diagram a `.nojekyll` vypíná zpracování Jekyllem. Po push do `main`
se web aktualizuje automaticky. Jde pouze o veřejnou dokumentaci, nikoli
autentizovaný účastnický portál nebo jeho Function backend.