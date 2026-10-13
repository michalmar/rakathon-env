import type { ModelDeployment } from "./catalog";

const providerPresentation: Record<ModelDeployment["format"], { name: string; logo?: string; wordmark?: string }> = {
  OpenAI: { name: "OpenAI", logo: "/provider-openai.svg" },
  xAI: { name: "xAI", wordmark: "xAI" },
  DeepSeek: { name: "DeepSeek", logo: "/provider-deepseek.svg" },
  Microsoft: { name: "Microsoft AI", logo: "/microsoft-logo.png" },
  MoonshotAI: { name: "Moonshot AI / Kimi", logo: "/provider-kimi.ico" },
};

export function providerMark(format: ModelDeployment["format"]): HTMLElement {
  const provider = providerPresentation[format];
  const mark = document.createElement("span");
  mark.className = `provider-mark provider-${format.toLowerCase()}`;
  mark.title = provider.name;
  mark.setAttribute("aria-label", provider.name);
  if (provider.logo) {
    const image = document.createElement("img");
    image.className = "provider-logo";
    image.src = provider.logo;
    image.alt = "";
    mark.append(image);
  } else {
    const wordmark = document.createElement("span");
    wordmark.className = "provider-wordmark";
    wordmark.textContent = provider.wordmark ?? provider.name;
    mark.append(wordmark);
  }
  return mark;
}
