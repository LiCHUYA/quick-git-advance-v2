#!/usr/bin/env node

const { program } = require("commander");
const initializeGitRepo = require("../src/index");
const {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  CONFIG_FILE,
} = require("../src/config");
const GitUtils = require("../src/utils");
const inquirer = require("inquirer");
const chalk = require("chalk");
const path = require("path");
const fs = require("fs/promises");

// 添加调试日志
console.log("Debug: 程序启动");

// 简化的 gitignore 模板
const GITIGNORE_TEMPLATES = {
  node: `# Dependencies
node_modules/
package-lock.json
yarn.lock
pnpm-lock.yaml

# Build
dist/
build/

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# Environment
.env
.env.*

# Editor
.vscode/
.idea/
*.sublime-project
*.sublime-workspace

# System
.DS_Store
Thumbs.db`,

  python: `# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
.env/
dist/
build/
*.egg-info/

# Editor
.vscode/
.idea/

# System
.DS_Store
Thumbs.db`,

  java: `# Java
*.class
*.jar
*.war
target/
build/
.gradle/

# IDE
.idea/
*.iml
.vscode/

# System
.DS_Store
Thumbs.db`,

  web: `# Dependencies
node_modules/
bower_components/

# Build
dist/
build/
*.min.*

# Editor
.vscode/
.idea/

# System
.DS_Store
Thumbs.db`,
};

class CommandManager {
  constructor() {
    this.program = program;
    this.utils = GitUtils;
    console.log("Debug: CommandManager 初始化");
  }

  // 初始化命令
  setupInitCommand() {
    this.program
      .command("init")
      .description("初始化 Git 仓库")
      .option("-m, --multi", "配置多个远程仓库")
      .action(async (options) => {
        try {
          console.log("Debug: 开始执行 init 命令");

          if (options.multi) {
            // 先选择多仓库类型
            const { multiType } = await inquirer.prompt([
              {
                type: "list",
                name: "multiType",
                message: "选择多仓库类型：",
                choices: [
                  {
                    name: "不同平台的多仓库 (GitHub/Gitee)",
                    value: "cross-platform",
                  },
                  {
                    name: "同一平台的多仓库",
                    value: "same-platform",
                  },
                ],
              },
            ]);

            if (multiType === "cross-platform") {
              const { platforms } = await inquirer.prompt([
                {
                  type: "checkbox",
                  name: "platforms",
                  message: "选择要使用的代码托管平台：",
                  choices: [
                    { name: "GitHub", value: "github", checked: true },
                    { name: "Gitee", value: "gitee" },
                  ],
                  validate: (answer) =>
                    answer.length > 0 ? true : "请至少选择一个平台",
                },
              ]);

              const success = await initializeGitRepo({
                platforms,
                isMultiRepo: true,
                multiType: "cross-platform",
              });

              if (!success) {
                process.exit(1);
              }
            } else {
              // 同一平台的多仓库
              const { platform } = await inquirer.prompt([
                {
                  type: "list",
                  name: "platform",
                  message: "选择代码托管平台：",
                  choices: [
                    { name: "GitHub", value: "github" },
                    { name: "Gitee", value: "gitee" },
                  ],
                },
              ]);

              const { remotes } = await inquirer.prompt([
                {
                  type: "input",
                  name: "remotes",
                  message: "输入远程仓库地址（多个地址用逗号分隔）：",
                  validate: (input) => {
                    if (!input) return "请输入至少一个远程仓库地址";
                    const urls = input.split(",").map((url) => url.trim());
                    const valid = urls.every((url) => {
                      return (
                        url.startsWith("git@") || url.startsWith("https://")
                      );
                    });
                    return valid || "请输入有效的 Git 仓库地址";
                  },
                },
              ]);

              const success = await initializeGitRepo({
                platform,
                remotes: remotes.split(",").map((url) => url.trim()),
                isMultiRepo: true,
                multiType: "same-platform",
              });

              if (!success) {
                process.exit(1);
              }
            }
          } else {
            // 原有的单仓库逻辑
            const success = await initializeGitRepo();
            if (!success) {
              process.exit(1);
            }
          }

          console.log("Debug: init 命令执行完成");
        } catch (error) {
          console.error(chalk.red("初始化失败:"), error.message);
          process.exit(1);
        }
      });
  }

  // 配置命令
  setupConfigCommand() {
    this.program
      .command("config")
      .description("查看或修改配置")
      .option("-e, --edit", "使用编辑器打开配置文件")
      .option("-l, --list", "列出所有配置")
      .option("-g, --get <key>", "获取指定配置项")
      .option("-s, --set <key> <value>", "设置配置项")
      .option("-d, --delete <key>", "删除配置项")
      .option("-i, --ignore", "配置 .gitignore 文件")
      .action(async (options) => {
        try {
          const config = await loadConfig();

          // 处理 .gitignore 配置
          if (options.ignore) {
            const gitignorePath = path.join(process.cwd(), ".gitignore");
            const templates = config.ignoreTemplates || ["node"];

            // 检查是否已存在 .gitignore
            const exists = await fs.access(gitignorePath).catch(() => false);

            if (exists) {
              const { action } = await inquirer.prompt([
                {
                  type: "list",
                  name: "action",
                  message: ".gitignore 文件已存在，请选择操作：",
                  choices: [
                    { name: "编辑现有文件", value: "edit" },
                    { name: "重新生成", value: "regenerate" },
                    { name: "取消", value: "cancel" },
                  ],
                },
              ]);

              if (action === "cancel") {
                return;
              }

              if (action === "edit") {
                // 使用编辑器打开现有文件
                const editor =
                  process.env.EDITOR || process.env.VISUAL || "vim";
                const { spawn } = require("child_process");
                const child = spawn(editor, [gitignorePath], {
                  stdio: "inherit",
                  shell: true,
                });
                return;
              }
            }

            // 选择要包含的模板
            const { selectedTemplates } = await inquirer.prompt([
              {
                type: "checkbox",
                name: "selectedTemplates",
                message: "选择要包含的忽略规则：",
                choices: [
                  { name: "Node.js", value: "node", checked: true },
                  { name: "Python", value: "python" },
                  { name: "Java", value: "java" },
                  {
                    name: "Visual Studio Code",
                    value: "vscode",
                    checked: true,
                  },
                  { name: "JetBrains IDEs", value: "jetbrains" },
                  { name: "macOS", value: "macos" },
                  { name: "Windows", value: "windows" },
                ],
              },
            ]);

            // 生成 .gitignore 内容
            let content = "# Generated by quick-git-advance\n\n";

            for (const template of selectedTemplates) {
              content += `# ${template} specific\n`;
              switch (template) {
                case "node":
                  content +=
                    "node_modules/\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n.pnpm-debug.log*\n";
                  break;
                case "python":
                  content +=
                    "*.py[cod]\n__pycache__/\n*.so\n.Python\nenv/\nvenv/\n.env\n";
                  break;
                case "java":
                  content +=
                    "*.class\n*.jar\n*.war\ntarget/\n.gradle/\nbuild/\n";
                  break;
                case "vscode":
                  content += ".vscode/\n*.code-workspace\n";
                  break;
                case "jetbrains":
                  content += ".idea/\n*.iml\n*.iws\n";
                  break;
                case "macos":
                  content += ".DS_Store\n.AppleDouble\n.LSOverride\n";
                  break;
                case "windows":
                  content += "Thumbs.db\nDesktop.ini\n$RECYCLE.BIN/\n";
                  break;
              }
              content += "\n";
            }

            // 保存文件
            await fs.writeFile(gitignorePath, content);
            console.log(chalk.green("✓ .gitignore 文件已生成"));

            // 更新配置中的模板列表
            config.ignoreTemplates = selectedTemplates;
            await saveConfig(config);
            return;
          }

          // 使用编辑器打开配置文件
          if (options.edit) {
            if (!CONFIG_FILE) {
              console.error(chalk.red("错误: 无法找到配置文件路径"));
              process.exit(1);
            }

            // 检测运行环境
            const isWindows = process.platform === "win32";
            const isGitBash = process.env.MSYSTEM || process.env.MINGW_PREFIX;

            let editor;
            if (isWindows && !isGitBash) {
              // Windows 环境下使用 notepad
              editor = "notepad";
              console.log(
                chalk.yellow("提示: 在 Windows 环境下默认使用记事本打开")
              );
              console.log(
                chalk.yellow("如需使用 vim，请在 Git Bash 中运行此命令")
              );
            } else {
              // Git Bash 或类 Unix 环境下使用 vim
              editor = process.env.EDITOR || process.env.VISUAL || "vim";
            }

            const { spawn } = require("child_process");
            console.log(chalk.cyan(`正在使用 ${editor} 打开配置文件...`));

            try {
              const child = spawn(editor, [CONFIG_FILE], {
                stdio: "inherit",
                shell: true,
              });

              child.on("error", (err) => {
                if (err.code === "ENOENT") {
                  console.error(chalk.red(`错误: 找不到编辑器 ${editor}`));
                  if (isWindows && !isGitBash) {
                    console.log(chalk.yellow("\n您可以："));
                    console.log(
                      chalk.yellow("1. 使用 Git Bash 运行此命令以使用 vim")
                    );
                    console.log(
                      chalk.yellow("2. 手动编辑配置文件：" + CONFIG_FILE)
                    );
                  }
                } else {
                  console.error(chalk.red("打开编辑器失败:"), err.message);
                }
                process.exit(1);
              });

              child.on("exit", (code) => {
                if (code === 0) {
                  console.log(chalk.green("✓ 配置文件已更新"));
                } else {
                  console.log(chalk.yellow("配置文件编辑被取消"));
                }
              });
            } catch (error) {
              console.error(chalk.red("启动编辑器失败:"), error.message);
              console.log(chalk.yellow("\n配置文件路径：" + CONFIG_FILE));
              process.exit(1);
            }
            return;
          }

          // 列出所有配置
          if (options.list) {
            console.log(chalk.cyan("当前配置:"));
            console.log(JSON.stringify(config, null, 2));
            return;
          }

          // 获取配置
          if (options.get) {
            const value = options.get
              .split(".")
              .reduce((obj, key) => obj?.[key], config);
            if (value === undefined) {
              console.log(chalk.yellow("未找到配置项"));
              return;
            }
            console.log(
              typeof value === "object" ? JSON.stringify(value, null, 2) : value
            );
            return;
          }

          // 设置配置
          if (options.set) {
            const [key, value] = options.set.split("=").map((s) => s.trim());
            if (!key || !value) {
              console.log(chalk.red("请使用格式: config --set key=value"));
              return;
            }

            const keys = key.split(".");
            const lastKey = keys.pop();
            const target = keys.reduce((obj, k) => {
              if (!obj[k]) obj[k] = {};
              return obj[k];
            }, config);

            try {
              // 尝试解析为 JSON
              target[lastKey] = JSON.parse(value);
            } catch {
              // 如果不是有效的 JSON，则作为字符串处理
              target[lastKey] = value;
            }

            await saveConfig(config);
            console.log(chalk.green("✓ 配置已更新"));
            return;
          }

          // 删除配置
          if (options.delete) {
            const keys = options.delete.split(".");
            const lastKey = keys.pop();
            const target = keys.reduce((obj, k) => obj?.[k], config);

            if (target && lastKey in target) {
              delete target[lastKey];
              await saveConfig(config);
              console.log(chalk.green("✓ 配置项已删除"));
            } else {
              console.log(chalk.yellow("未找到配置项"));
            }
            return;
          }

          // 默认显示所有配置
          console.log(JSON.stringify(config, null, 2));
        } catch (error) {
          console.error(chalk.red("配置操作失败:"), error.message);
          process.exit(1);
        }
      });
  }

  // 添加新的 gitignore 命令
  setupIgnoreCommand() {
    this.program
      .command("ignore")
      .description("生成 .gitignore 文件")
      .action(async () => {
        try {
          const gitignorePath = path.join(process.cwd(), ".gitignore");

          // 检查是否已存在
          const exists = await fs.access(gitignorePath).catch(() => false);
          if (exists) {
            const { action } = await inquirer.prompt([
              {
                type: "list",
                name: "action",
                message: ".gitignore 文件已存在，请选择操作：",
                choices: [
                  { name: "重新生成", value: "regenerate" },
                  { name: "取消", value: "cancel" },
                ],
              },
            ]);

            if (action === "cancel") {
              return;
            }
          }

          // 选择项目类型
          const { type } = await inquirer.prompt([
            {
              type: "list",
              name: "type",
              message: "选择项目类型：",
              choices: [
                { name: "Node.js / JavaScript", value: "node" },
                { name: "Python", value: "python" },
                { name: "Java", value: "java" },
                { name: "Web 前端", value: "web" },
              ],
            },
          ]);

          // 生成文件
          const content = `# Generated by quick-git-advance\n\n${GITIGNORE_TEMPLATES[type]}`;
          await fs.writeFile(gitignorePath, content);
          console.log(chalk.green("✓ .gitignore 文件已生成"));
        } catch (error) {
          console.error(chalk.red("生成 .gitignore 失败:"), error.message);
          process.exit(1);
        }
      });
  }

  // 重置命令
  setupResetCommand() {
    this.program
      .command("reset")
      .description("重置配置")
      .action(async () => {
        try {
          await saveConfig(DEFAULT_CONFIG);
          console.log("配置已重置为默认值");
        } catch (error) {
          console.error("Error:", error);
          process.exit(1);
        }
      });
  }

  // 设置主程序信息
  setupMainProgram() {
    this.program
      .name("quick-git-advance")
      .description("Git 仓库快速初始化工具")
      .version("1.0.1");
  }

  // 初始化命令
  setupCommands() {
    try {
      this.setupMainProgram();
      this.setupInitCommand();
      this.setupConfigCommand();
      this.setupIgnoreCommand();
      this.setupResetCommand();

      console.log("Debug: 命令设置完成，开始解析参数");
      this.program.parse(process.argv);

      // 如果没有任何命令，显示帮助
      if (!process.argv.slice(2).length) {
        this.program.outputHelp();
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  }
}

async function collectRepoInfo() {
  const config = await loadConfig();

  return inquirer.prompt([
    {
      type: "list",
      name: "visibility",
      message: "仓库可见性:",
      choices: [
        { name: "公开", value: "public" },
        { name: "私有", value: "private" },
      ],
    },
    {
      type: "input",
      name: "mainBranch",
      message: "主分支名称:",
      default: config.defaultBranch || "master",
    },
    {
      type: "confirm",
      name: "needDevBranch",
      message: "是否需要创建独立的开发分支?",
      default: false,
    },
    {
      type: "input",
      name: "developBranch",
      message: "开发分支名称:",
      default: config.developBranch || "develop",
      when: (answers) => answers.needDevBranch,
    },
  ]);
}

// 立即执行
try {
  console.log("Debug: 启动命令管理器");
  new CommandManager().setupCommands();
} catch (error) {
  console.error("启动失败:", error);
  process.exit(1);
}
