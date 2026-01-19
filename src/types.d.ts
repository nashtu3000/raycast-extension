declare module "turndown" {
  export default class TurndownService {
    constructor(options?: any);
    turndown(html: string): string;
    use(plugin: any): this;
    addRule(key: string, rule: any): this;
  }
}

declare module "turndown-plugin-gfm" {
  export const gfm: any;
}

declare module "cheerio-tableparser" {
  const cheerioTableparser: any;
  export default cheerioTableparser;
}
