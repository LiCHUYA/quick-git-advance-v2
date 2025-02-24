const inquirer = require("inquirer");
const chalk = require("chalk");
const { loadConfig, saveConfig } = require("./config");
const GitUtils = require("./utils");
const fetch = require("node-fetch");
const { Octokit } = require("@octokit/rest");
const { execSync } = require("child_process");

const PLATFORM_INFO = {
  github: {
    name: "GitHub",
    tokenUrl: "https://github.com/settings/tokens",
    tokenInstructions: [
      "1. 访问 https://github.com/settings/tokens",
      "2. 点击 'Generate new token'",
      "3. 勾选 'repo' 权限",
    ],
  },
  gitee: {
    name: "Gitee",
    tokenUrl: "https://gitee.com/profile/personal_access_tokens",
    tokenInstructions: [
      "1. 访问 https://gitee.com/profile/personal_access_tokens",
      "2. 点击 '生成新令牌'",
      "3. 勾选 'projects' 权限",
    ],
  },
};

// 添加令牌获取指南
const TOKEN_GUIDES = {
  github: {
    steps: [
      "1. 访问 GitHub 令牌设置页面：https://github.com/settings/tokens",
      "2. 点击 'Generate new token (classic)'",
      "3. 填写令牌描述（如：Quick Git Advance）",
      "4. 勾选以下权限：",
      "   - repo（完整仓库访问权限）",
      "   - admin:public_key（SSH 密钥管理权限）",
      "5. 点击底部的 'Generate token' 按钮",
      "6. 复制生成的令牌（注意：令牌只显示一次！）",
    ],
    url: "https://github.com/settings/tokens",
  },
  gitee: {
    steps: [
      "1. 访问 Gitee 令牌设置页面：https://gitee.com/profile/personal_access_tokens",
      "2. 点击 '生成新令牌'",
      "3. 填写私人令牌描述（如：Quick Git Advance）",
      "4. 勾选以下权限：",
      "   - projects（仓库操作权限）",
      "   - keys（SSH 密钥管理权限）",
      "5. 点击 '提交' 按钮",
      "6. 复制生成的令牌（注意：令牌只显示一次！）",
    ],
    url: "https://gitee.com/profile/personal_access_tokens",
  },
};

function promptPlatformSetup(platform, currentConfig = {}) {
  const platformInfo = PLATFORM_INFO[platform];
  console.log(chalk.blue(`\n配置 ${platformInfo.name} 平台信息`));

  return inquirer.prompt([
    {
      type: "input",
      name: "username",
      message: `输入 ${platformInfo.name} 邮箱:`,
      default: currentConfig.platforms?.[platform]?.username || "",
      validate: (input) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(input) || "请输入有效的邮箱地址";
      },
    },
    {
      type: "input",
      name: "token",
      message: `输入 ${platformInfo.name} 访问令牌:`,
      validate: (input) => input.length > 0 || "访问令牌不能为空",
    },
  ]);
}

async function promptInitialSetup() {
  console.log(chalk.blue("欢迎使用 quick-git-init！首次使用需要进行配置。"));

  const config = await loadConfig();

  // 选择要配置的平台
  const { platforms } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "platforms",
      message: "选择要配置的代码托管平台:",
      choices: [
        { name: "GitHub", value: "github" },
        { name: "Gitee", value: "gitee" },
      ],
      validate: (input) => input.length > 0 || "至少选择一个平台",
    },
  ]);

  // 配置默认设置
  const defaultSettings = await inquirer.prompt([
    {
      type: "list",
      name: "defaultPlatform",
      message: "选择默认使用的平台:",
      choices: platforms.map((p) => ({
        name: PLATFORM_INFO[p].name,
        value: p,
      })),
    },
    {
      type: "input",
      name: "defaultBranch",
      message: "默认主分支名称:",
      default: config.defaultBranch || "main",
    },
    {
      type: "input",
      name: "developBranch",
      message: "默认开发分支名称:",
      default: config.developBranch || "develop",
    },
  ]);

  // 为每个选择的平台配置信息
  const platformConfigs = {};
  for (const platform of platforms) {
    const platformConfig = await promptPlatformSetup(platform, config);
    platformConfigs[platform] = platformConfig;
  }

  // 合并配置
  const newConfig = {
    ...config,
    ...defaultSettings,
    platforms: {
      ...config.platforms,
      ...Object.keys(platformConfigs).reduce((acc, platform) => {
        acc[platform] = platformConfigs[platform];
        return acc;
      }, {}),
    },
  };

  await saveConfig(newConfig);
  console.log(chalk.green("\n✓ 配置完成！"));
}

async function ensureAuth(platform) {
  const config = await loadConfig();
  let platformConfig = config.platforms[platform];
  let retryCount = 0;
  const MAX_RETRIES = 3;

  while (retryCount < MAX_RETRIES) {
    try {
      // 获取认证信息
      if (!platformConfig.username || !platformConfig.token || retryCount > 0) {
        // 显示令牌获取指南
        const guide = TOKEN_GUIDES[platform];
        console.log(chalk.cyan("\n=== 如何获取访问令牌 ==="));
        guide.steps.forEach((step) => console.log(chalk.white(step)));
        console.log(chalk.cyan("====================="));

        // 询问是否自动打开令牌页面
        const { openBrowser } = await inquirer.prompt([
          {
            type: "confirm",
            name: "openBrowser",
            message: "是否自动打开令牌设置页面?",
            default: true,
          },
        ]);

        if (openBrowser) {
          const command =
            process.platform === "win32"
              ? "start"
              : process.platform === "darwin"
              ? "open"
              : "xdg-open";
          execSync(`${command} ${guide.url}`);
          console.log(chalk.green("✓ 已打开令牌设置页面"));
        }

        const answers = await inquirer.prompt([
          {
            type: "input",
            name: "username",
            message: `请输入 ${platform} 邮箱:`,
            default: platformConfig.username,
            validate: (input) =>
              GitUtils.isValidEmail(input) || "请输入有效的邮箱地址",
          },
          {
            type: "input",
            name: "token",
            message: `请输入 ${platform} 访问令牌:`,
            validate: (input) => input.length > 0 || "令牌不能为空",
          },
        ]);

        platformConfig = {
          ...platformConfig,
          username: answers.username,
          token: answers.token,
        };

        // 更新配置
        config.platforms[platform] = platformConfig;
        await saveConfig(config);
      }

      // 验证令牌
      await validateToken(platform, platformConfig);
      GitUtils.log.success(`${platform} 认证成功`);

      // 配置 SSH
      console.log(chalk.cyan("\n=== SSH 密钥配置 ==="));
      console.log(chalk.white("将为您自动配置 SSH 密钥，包括："));
      console.log(chalk.white("1. 生成 SSH 密钥（如果不存在）"));
      console.log(chalk.white("2. 自动添加到远程平台"));
      console.log(chalk.white("3. 测试 SSH 连接"));
      console.log(chalk.cyan("==================="));

      await GitUtils.setupSsh(
        platform,
        platformConfig.username,
        platformConfig.token
      );
      GitUtils.log.success(`${platform} SSH 配置成功`);

      return platformConfig;
    } catch (error) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`${platform} 认证失败，已达到最大重试次数`);
      }
      GitUtils.log.warning(`认证失败: ${error.message}`);
      GitUtils.log.info("请重新输入认证信息");
      platformConfig = {
        username: "",
        token: "",
        defaultVisibility: "public",
        defaultLicense: "MIT",
      };
    }
  }
}

// 修改令牌验证方法，添加错误处理
async function validateToken(platform, config) {
  try {
    if (platform === "github") {
      const octokit = new Octokit({ auth: config.token });
      await octokit.users.getAuthenticated();
    } else if (platform === "gitee") {
      const response = await fetch(
        `https://gitee.com/api/v5/user?access_token=${config.token}`
      );
      if (!response.ok) {
        throw new Error(`令牌验证失败 (HTTP ${response.status})`);
      }
      const data = await response.json();
      if (!data.id) {
        throw new Error("无效的响应数据");
      }
      console.log("Debug: Gitee 用户验证成功:", {
        username: data.login,
        name: data.name,
      });
    }
  } catch (error) {
    throw new Error(`${platform} 令牌验证失败: ${error.message}`);
  }
}

// 修改添加 SSH 密钥到 GitHub 的方法
async function addSshKeyToGitHub(token, publicKey, keyTitle) {
  const octokit = new Octokit({ auth: token });

  try {
    // 新的 API 调用方式
    await octokit.request("POST /user/keys", {
      title: keyTitle,
      key: publicKey,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    return true;
  } catch (error) {
    if (
      error.status === 422 &&
      error.message.includes("key is already in use")
    ) {
      // 密钥已存在，视为成功
      return true;
    }
    throw new Error(`添加 SSH 密钥到 GitHub 失败: ${error.message}`);
  }
}

module.exports = {
  ensureAuth,
  promptPlatformSetup: promptPlatformSetup,
  promptInitialSetup,
  PLATFORM_INFO,
};
