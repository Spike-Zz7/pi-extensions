import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import skillManagerExtension from "./extension.ts";

export default function skillManager(pi: ExtensionAPI) {
  skillManagerExtension(pi, {
    agentDir: getAgentDir(),
    configDirName: CONFIG_DIR_NAME,
    parseSkillFrontmatter: (content: string) => parseFrontmatter(content).frontmatter,
  });
}
