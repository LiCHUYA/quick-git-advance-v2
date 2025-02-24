const chalk = require("chalk");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const fetch = require("node-fetch");
const inquirer = require("inquirer");
const { Octokit } = require("@octokit/rest");

// 工具函数集合
class GitUtils {
  // 检查目录是否已经是 Git 仓库
  static async isGitRepository(dir) {
    try {
      await fs.access(path.join(dir, ".git"));
      return true;
    } catch {
      return false;
    }
  }

  // 格式化日志输出
  static log = {
    success: (msg) => console.log(chalk.green(`✓ ${msg}`)),
    info: (msg) => console.log(chalk.blue(msg)),
    warning: (msg) => console.log(chalk.yellow(`⚠ ${msg}`)),
    error: (msg) => console.error(chalk.red(`✗ ${msg}`)),
  };

  // SSH 密钥配置指南
  static getSshGuide(platform) {
    return [
      "SSH 密钥配置步骤:",
      "1. 生成 SSH 密钥: ssh-keygen -t rsa -b 4096",
      "2. 复制公钥内容: cat ~/.ssh/id_rsa.pub",
      `3. 将公钥添加到 ${platform} 平台`,
    ].join("\n");
  }

  // 验证邮箱格式
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // 处理错误
  static handleError(error, context = "") {
    const message = context ? `${context}: ${error.message}` : error.message;
    GitUtils.log.error(message);
    return false;
  }

  // 检查 SSH 配置
  static async checkSshConfig(platform) {
    try {
      const host = platform === "github" ? "github.com" : "gitee.com";
      // 检查 SSH 配置
      const result = execSync(`ssh -T git@${host}`, {
        stdio: "pipe",
        timeout: 5000,
        encoding: "utf8",
      });
      return true;
    } catch (error) {
      // 某些平台成功时也会返回非零状态码，需要检查错误信息
      const successMessages = {
        github: "Hi",
        gitee: "Welcome to Gitee.com",
      };

      if (error.stderr && error.stderr.includes(successMessages[platform])) {
        return true;
      }

      console.log("Debug: SSH 检查错误:", error.message);
      return false;
    }
  }

  // 生成 SSH 密钥
  static async generateSshKey(email) {
    try {
      const sshPath = path.join(os.homedir(), ".ssh", "id_rsa");

      // 检查是否已存在
      try {
        await fs.access(sshPath);
        return { exists: true, path: sshPath };
      } catch {
        // 不存在则生成
        execSync(
          `ssh-keygen -t rsa -b 4096 -C "${email}" -f "${sshPath}" -N ""`,
          {
            stdio: "pipe",
          }
        );
        return { exists: false, path: sshPath };
      }
    } catch (error) {
      throw new Error(`生成 SSH 密钥失败: ${error.message}`);
    }
  }

  // 获取公钥内容
  static async getPublicKey() {
    try {
      const pubKeyPath = path.join(os.homedir(), ".ssh", "id_rsa.pub");
      return await fs.readFile(pubKeyPath, "utf8");
    } catch (error) {
      throw new Error(`读取公钥失败: ${error.message}`);
    }
  }

  // 自动添加 SSH 密钥到 Gitee
  static async addSshKeyToGitee(
    publicKey,
    token,
    keyName = "Quick Git Advance"
  ) {
    try {
      const response = await fetch("https://gitee.com/api/v5/user/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          access_token: token,
          title: keyName,
          key: publicKey,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        // 如果密钥已存在，不视为错误
        if (error.message?.includes("已经存在")) {
          return true;
        }
        throw new Error(`添加失败: ${error.message}`);
      }
      return true;
    } catch (error) {
      throw new Error(`添加 SSH 密钥到 Gitee 失败: ${error.message}`);
    }
  }

  // 自动添加 SSH 密钥到 GitHub
  static async addSshKeyToGithub(
    publicKey,
    token,
    keyName = "Quick Git Advance"
  ) {
    try {
      const octokit = new Octokit({ auth: token });
      await octokit.rest.users.createPublicSshKey({
        title: keyName,
        key: publicKey,
      });
      return true;
    } catch (error) {
      // 如果密钥已存在，不视为错误
      if (error.message.includes("key is already in use")) {
        return true;
      }
      throw new Error(`添加 SSH 密钥到 GitHub 失败: ${error.message}`);
    }
  }

  // 检查并配置 SSH
  static async setupSsh(platform, email, token) {
    try {
      // 先检查现有配置
      const hasSshConfig = await this.checkSshConfig(platform);
      if (hasSshConfig) {
        this.log.success(`${platform} SSH 配置已存在且可用`);
        return true;
      }

      this.log.info(`\n开始配置 ${platform} 的 SSH 密钥...`);

      // 生成 SSH 密钥
      const { exists, path } = await this.generateSshKey(email);
      if (exists) {
        this.log.info("检测到已有 SSH 密钥，将使用现有密钥");
      } else {
        this.log.success("已生成新的 SSH 密钥");
      }

      const publicKey = await this.getPublicKey();

      // 根据平台自动添加 SSH 密钥
      this.log.info(`正在自动添加 SSH 密钥到 ${platform}...`);
      if (platform === "gitee") {
        await this.addSshKeyToGitee(publicKey, token);
      } else {
        await this.addSshKeyToGithub(publicKey, token);
      }
      this.log.success(`SSH 密钥已自动添加到 ${platform}`);

      // 测试连接
      this.log.info("正在测试 SSH 连接...");
      const testResult = await this.checkSshConfig(platform);
      if (testResult) {
        this.log.success(`${platform} SSH 配置测试成功`);
        return true;
      } else {
        throw new Error("SSH 连接测试失败");
      }
    } catch (error) {
      throw new Error(`SSH 配置失败: ${error.message}`);
    }
  }

  // 获取 SSH 配置指南 (可以删除了，因为流程更自动化了)
  static getSshSetupGuide(platform) {
    return null;
  }
}

module.exports = GitUtils;
