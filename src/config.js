const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const chalk = require("chalk");

// 修改配置文件名为 .git-advance-config.json
const CONFIG_FILE = path.join(os.homedir(), ".git-advance-config.json");

// 默认配置
const DEFAULT_CONFIG = {
  defaultPlatform: "",
  defaultBranch: "master",
  developBranch: "develop",
  platforms: {
    github: {
      username: "",
      token: "",
      defaultVisibility: "public",
      defaultLicense: "MIT",
    },
    gitee: {
      username: "",
      token: "",
      defaultVisibility: "public",
      defaultLicense: "MIT",
    },
  },
  ignoreTemplates: ["node"],
  autoInit: true,
  createDevBranch: false,
  pushImmediately: true,
  skipSshCheck: false, // 是否跳过 SSH 检查
};

async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    // 如果文件不存在，返回默认配置
    if (error.code === "ENOENT") {
      await saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

async function saveConfig(config) {
  try {
    // 确保配置目录存在
    const configDir = path.dirname(CONFIG_FILE);
    await fs.mkdir(configDir, { recursive: true });

    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(chalk.green("✓ 配置保存成功"));
  } catch (error) {
    console.error(chalk.red("保存配置失败："), error.message);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  CONFIG_FILE,
};
