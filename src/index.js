const simpleGit = require("simple-git");
const { Octokit } = require("@octokit/rest");
const fs = require("fs").promises;
const path = require("path");
const inquirer = require("inquirer");
const fetch = require("node-fetch");
const { loadConfig, saveConfig } = require("./config");
const { ensureAuth } = require("./auth");
const GitUtils = require("./utils");
const chalk = require("chalk");

// 通用的 .gitignore 模板
const DEFAULT_GITIGNORE = `# Dependencies
/node_modules
/.pnp
.pnp.js

# Testing
/coverage

# Production
/build
/dist

# Misc
.DS_Store
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Editor
.idea/
.vscode/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db`;

class GitInitializer {
  constructor() {
    this.git = simpleGit();
    this.utils = GitUtils;
    console.log("Debug: GitInitializer 初始化");
  }

  // 检查本地仓库冲突
  async checkLocalConflicts(repoName) {
    try {
      // 检查目标目录是否存在
      if (
        await fs.access(path.join(process.cwd(), repoName)).catch(() => false)
      ) {
        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: `目录 ${repoName} 已存在，请选择操作:`,
            choices: [
              { name: "在当前目录初始化", value: "current" },
              { name: "使用新目录", value: "new" },
              { name: "取消操作", value: "cancel" },
            ],
          },
        ]);

        if (action === "cancel") {
          throw new Error("用户取消操作");
        }

        if (action === "new") {
          const { newName } = await inquirer.prompt([
            {
              type: "input",
              name: "newName",
              message: "请输入新的目录名:",
              default: `${repoName}-new`,
              validate: (input) => input.length > 0 || "目录名不能为空",
            },
          ]);
          return newName;
        }
      }

      return repoName;
    } catch (error) {
      throw new Error(`检查本地冲突失败: ${error.message}`);
    }
  }

  // 修改初始化方法
  async initialize(options = {}) {
    try {
      console.log("Debug: 开始初始化流程");

      // 检查当前目录是否已是 Git 仓库
      const isGitRepo = await this.utils.isGitRepository(process.cwd());

      // 获取基本信息
      const basicInfo = await this.collectBasicInfo(options);
      console.log("Debug: 收集到基本信息", basicInfo);

      // 收集仓库信息（可见性、描述等）
      const repoInfo = await this.collectRepoInfo();

      if (options.isMultiRepo) {
        // 多仓库模式
        const repoInfos = {}; // 存储各平台的仓库信息
        for (const platform of options.platforms) {
          try {
            // 获取平台配置
            const config = await this.ensurePlatformConfig(platform);

            // 创建远程仓库
            try {
              const createdRepo = await this.createRemoteRepo({
                ...basicInfo,
                ...repoInfo,
                platform,
                config,
              });
              repoInfos[platform] = createdRepo;
              this.utils.log.success(`${platform} 远程仓库创建成功`);
            } catch (error) {
              if (error.message.includes("用户取消")) {
                this.utils.log.warning(`已跳过 ${platform} 仓库创建`);
                continue;
              }
              throw error;
            }
          } catch (error) {
            this.utils.log.error(`${platform} 平台操作失败: ${error.message}`);
          }
        }

        // 询问是否需要初始化本地仓库
        const { initLocal } = await inquirer.prompt([
          {
            type: "confirm",
            name: "initLocal",
            message: "是否要初始化本地仓库并关联远程？",
            default: true,
          },
        ]);

        if (initLocal) {
          // 初始化本地仓库
          await this.git.init();
          await this.createGitignore();
          await this.git.add(".");
          await this.git.commit("Initial commit");

          // 添加远程仓库
          let hasSetUpstream = false; // 标记是否设置了上游分支
          for (const platform of options.platforms) {
            try {
              const createdRepo = repoInfos[platform];
              if (!createdRepo) continue;

              const remoteUrl = this.getRemoteUrl(
                platform,
                createdRepo.owner,
                createdRepo.name
              );

              if (!hasSetUpstream) {
                // 第一个远程仓库设为 origin 并设置上游分支
                await this.git.addRemote("origin", remoteUrl);
                await this.git.push(["-u", "origin", repoInfo.mainBranch]);
                hasSetUpstream = true;
                this.utils.log.success(`已设置 origin 为 ${platform} 并推送`);
              } else {
                // 其他远程仓库使用平台名称
                await this.git.addRemote(platform, remoteUrl);
                await this.git.push([platform, repoInfo.mainBranch]);
                this.utils.log.success(`已推送到 ${platform}`);
              }
            } catch (error) {
              this.utils.log.error(
                `添加 ${platform} 远程仓库失败: ${error.message}`
              );
            }
          }

          // 如果需要创建开发分支
          if (repoInfo.needDevBranch) {
            await this.git.checkoutLocalBranch(repoInfo.developBranch);
            // 推送开发分支到所有远程
            if (hasSetUpstream) {
              await this.git.push(["-u", "origin", repoInfo.developBranch]);
            }
            for (const platform of options.platforms) {
              if (platform !== "origin") {
                await this.git.push([platform, repoInfo.developBranch]);
              }
            }
            await this.git.checkout(repoInfo.mainBranch);
            this.utils.log.success("已创建并推送开发分支");
          }
        }
      } else {
        // 单仓库模式
        // ... 原有的单仓库逻辑 ...
      }

      return true;
    } catch (error) {
      console.error("初始化失败:", error);
      if (!error.message.includes("用户取消")) {
        await this.cleanupOnFailure();
      }
      return false;
    }
  }

  // 收集基本信息
  async collectBasicInfo(options) {
    // 多仓库模式下只需要仓库名称
    if (options.isMultiRepo) {
      return inquirer.prompt([
        {
          type: "input",
          name: "repoName",
          message: "仓库名称:",
          validate: (input) => input.length > 0 || "仓库名称不能为空",
        },
      ]);
    }

    // 单仓库模式需要选择平台
    return inquirer.prompt([
      {
        type: "input",
        name: "repoName",
        message: "仓库名称:",
        validate: (input) => input.length > 0 || "仓库名称不能为空",
      },
      {
        type: "list",
        name: "platform",
        message: "选择代码托管平台:",
        choices: [
          { name: "GitHub", value: "github" },
          { name: "Gitee", value: "gitee" },
        ],
      },
    ]);
  }

  // 确保平台配置
  async ensurePlatformConfig(platform) {
    return await ensureAuth(platform);
  }

  // 收集仓库信息
  async collectRepoInfo() {
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
        name: "description",
        message: "仓库描述:",
        default: "Created by Quick Git Advance",
        validate: (input) => input.length <= 255 || "描述不能超过255个字符",
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
        default: "master",
        when: (answers) => answers.needDevBranch,
      },
    ]);
  }

  // 添加创建远程仓库的方法
  async createRemoteRepo(options) {
    const { platform, repoName, visibility, description, config } = options;

    try {
      if (platform === "github") {
        const octokit = new Octokit({ auth: config.token });
        const response = await octokit.repos.createForAuthenticatedUser({
          name: repoName,
          private: visibility === "private",
          description: description,
          auto_init: false,
        });
        // 返回创建的仓库信息
        return {
          name: response.data.name,
          owner: response.data.owner.login, // 获取正确的用户名
        };
      } else if (platform === "gitee") {
        const response = await fetch("https://gitee.com/api/v5/user/repos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            access_token: config.token,
            name: repoName,
            private: visibility === "private",
            description: description,
            auto_init: false,
            path: repoName, // 添加 path 参数
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          // Gitee 的错误信息在 message 字段中
          throw new Error(error.message || `HTTP 错误 ${response.status}`);
        }

        const data = await response.json();
        if (!data.name) {
          throw new Error("创建仓库失败：返回数据无效");
        }

        return {
          name: data.name,
          owner: data.owner.login,
        };
      }
    } catch (error) {
      // 处理 Gitee 特定的错误
      if (error.message.includes("Repository name has already been taken")) {
        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: `${platform} 仓库 "${repoName}" 已存在，请选择操作:`,
            choices: [
              { name: "使用新名称", value: "rename" },
              { name: "取消操作", value: "cancel" },
            ],
          },
        ]);

        if (action === "cancel") {
          throw new Error(`用户取消 ${platform} 仓库创建`);
        }

        const { newName } = await inquirer.prompt([
          {
            type: "input",
            name: "newName",
            message: `请输入新的仓库名称:`,
            default: `${repoName}-new`,
            validate: (input) => input.length > 0 || "仓库名称不能为空",
          },
        ]);

        // 递归调用，使用新名称重试
        return this.createRemoteRepo({
          ...options,
          repoName: newName,
        });
      }

      throw new Error(`${platform} 仓库创建失败: ${error.message}`);
    }
  }

  // 初始化本地仓库
  async initializeLocalRepo(repoSshUrl, repoInfo) {
    const { mainBranch, developBranch, needDevBranch } = repoInfo;

    try {
      // 创建并写入 .gitignore
      await this.createGitignore();

      // 初始化 Git 仓库
      await this.git.init();
      this.utils.log.success("Git 仓库初始化成功");

      // 只添加 .gitignore 文件
      await this.git.add(".gitignore");
      await this.git.commit("chore: add .gitignore");
      this.utils.log.success("创建初始提交");

      // 推送前测试 SSH 连接
      const platform = repoSshUrl.includes("github.com") ? "github" : "gitee";
      const testCmd = `ssh -T git@${platform}.com`;

      try {
        await this.git.raw(["remote", "add", "origin", repoSshUrl]);
        this.utils.log.success(`添加远程仓库 ${repoSshUrl}`);
      } catch (error) {
        // 如果失败，清理已创建的文件
        await this.cleanupOnFailure();
        throw error;
      }

      // 如果推送失败，提供帮助信息
      try {
        await this.git.push(["-u", "origin", mainBranch]);
      } catch (error) {
        // 如果失败，清理已创建的文件
        await this.cleanupOnFailure();
        if (error.message.includes("Permission denied (publickey)")) {
          console.log(chalk.red("\n❌ SSH 推送失败"));
          throw new Error("SSH 认证失败，请确保已正确配置 SSH 密钥");
        }
        throw error;
      }

      // 设置主分支
      await this.git.branch(["-M", mainBranch]);
      this.utils.log.success(`主分支名称为 ${mainBranch}`);

      // 只有当需要开发分支且开发分支名与主分支名不同时才创建开发分支
      if (needDevBranch && developBranch && developBranch !== mainBranch) {
        await this.git.checkoutLocalBranch(developBranch);
        this.utils.log.success(`创建并切换到 ${developBranch} 分支`);
        await this.git.push(["-u", "origin", developBranch]);
        this.utils.log.success("推送开发分支到远程仓库");
        await this.git.checkout(mainBranch);
        this.utils.log.success(`切回 ${mainBranch} 分支`);
      }
    } catch (error) {
      // 如果任何步骤失败，清理已创建的文件
      await this.cleanupOnFailure();
      throw error;
    }
  }

  // 添加清理方法
  async cleanupOnFailure() {
    try {
      // 删除 .git 目录
      await fs.rm(path.join(process.cwd(), ".git"), {
        recursive: true,
        force: true,
      });
      // 删除 .gitignore 文件
      await fs.unlink(path.join(process.cwd(), ".gitignore")).catch(() => {});
      this.utils.log.info("已清理临时文件");
    } catch (error) {
      this.utils.log.warning("清理临时文件失败");
    }
  }

  // 添加 createGitignore 方法
  async createGitignore() {
    try {
      await fs.writeFile(".gitignore", DEFAULT_GITIGNORE);
      this.utils.log.success("创建 .gitignore 文件");
    } catch (error) {
      throw new Error(`创建 .gitignore 失败: ${error.message}`);
    }
  }

  // 添加清除平台配置的方法
  async clearPlatformConfig(platform) {
    const config = await loadConfig();
    config.platforms[platform] = {
      username: "",
      token: "",
      defaultVisibility: "public",
      defaultLicense: "MIT",
    };
    await saveConfig(config);
    this.utils.log.warning(`已清除 ${platform} 的配置信息`);
  }

  // 获取远程仓库 URL
  getRemoteUrl(platform, username, repoName) {
    switch (platform) {
      case "github":
        return `git@github.com:${username}/${repoName}.git`;
      case "gitee":
        return `git@gitee.com:${username}/${repoName}.git`;
      default:
        throw new Error(`不支持的平台: ${platform}`);
    }
  }

  // 修改添加远程仓库的逻辑
  async addRemoteRepo(platform, remoteUrl) {
    try {
      // 检查远程仓库是否已存在
      const remotes = await this.git.getRemotes();
      const exists = remotes.find((remote) => remote.name === platform);

      if (exists) {
        // 如果已存在，询问是否更新
        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: `远程仓库 ${platform} 已存在，请选择操作:`,
            choices: [
              { name: "更新地址", value: "update" },
              { name: "跳过", value: "skip" },
            ],
          },
        ]);

        if (action === "update") {
          await this.git.removeRemote(platform);
          await this.git.addRemote(platform, remoteUrl);
          this.utils.log.success(`已更新 ${platform} 远程仓库地址`);
        } else {
          this.utils.log.info(`已跳过 ${platform} 远程仓库配置`);
        }
      } else {
        // 如果不存在，直接添加
        await this.git.addRemote(platform, remoteUrl);
        this.utils.log.success(`已添加 ${platform} 远程仓库`);
      }
    } catch (error) {
      throw new Error(`添加远程仓库失败: ${error.message}`);
    }
  }
}

module.exports = new GitInitializer().initialize.bind(new GitInitializer());
