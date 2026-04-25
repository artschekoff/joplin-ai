# Publishing the AI Assistant Plugin

## Build for Production

```bash
npm install
npm run dist
```

This runs three webpack steps: compiles TypeScript, bundles assets, and creates a `.jpl` archive.

The output file will be at:

```
publish/net.roxl.joplin-ai.jpl
```

## Install in Joplin Desktop

1. Open **Joplin Desktop**.
2. Go to **Tools → Options → Plugins**.
3. Click the gear icon or **Install from file**.
4. Select the `.jpl` file from the `publish/` directory.
5. Restart Joplin when prompted.

After restart, configure the plugin via **Tools → Options → AI Assistant** (set API keys, choose provider/model, etc.).

## Before Distribution

Update the following fields in `src/manifest.json` before sharing publicly:


| Field             | Current Value                                | Action                                                                              |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`              | `net.roxl.joplin-ai`                         | Reverse-DNS identifier                                                              |
| `app_min_version` | `1.6`                                        | Bump to match the minimum Joplin version required by the APIs you use               |
| `homepage_url`    | *(empty)*                                    | Set to the project homepage or repository URL                                       |
| `repository_url`  | *(empty)*                                    | Set to the Git repository URL                                                       |
| `description`     | Current text only mentions Claude and OpenAI | Update to include Perplexity, image generation, and web search                      |


## Publishing to the Joplin Plugin Repository

To list this plugin in Joplin's official plugin directory:

1. Host the source code on a public GitHub repository.
2. Ensure `src/manifest.json` has a unique `id`, valid `homepage_url`, and `repository_url`.
3. Submit a PR to [joplin/plugins](https://github.com/joplin/plugins) following their [publishing guidelines](https://github.com/joplin/plugins#publishing-a-plugin).
4. The Joplin team will review and merge — once merged, the plugin appears in **Tools → Options → Plugins** search.

## Dev Mode vs Production


|          | Dev Mode                                      | Production                                      |
| -------- | --------------------------------------------- | ----------------------------------------------- |
| Command  | `npm run dev`                                 | `npm run dist`                                  |
| Output   | Watches `src/` and rebuilds on change         | Single build into `publish/*.jpl`               |
| Install  | Joplin loads from `dist/` via dev plugin path | User installs `.jpl` file from Plugins settings |
| Use case | Local development and testing                 | End-user distribution                           |


To use dev mode, set the Joplin dev plugin path to this project's root directory in **Tools → Options → Plugins → Advanced settings → Development plugin path**.