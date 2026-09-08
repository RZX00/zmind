// 🎯 Command Pattern Implementation
// 基础命令模式实现，用于Canvas操作的撤销/重做功能

// 📝 基础接口定义
export interface CommandResult {
  success: boolean;
  error?: string;
  data?: any;
  timestamp: number;
}

export interface AICommand {
  intent: string;
  parameters: Record<string, any>;
}

// 🎯 抽象命令接口
export interface Command {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly timestamp: number;
  readonly canUndo: boolean;

  execute(): Promise<CommandResult>;
  undo(): Promise<CommandResult>;
}

// 📚 命令历史记录
interface CommandHistory {
  commands: Command[];
  currentIndex: number;
  maxHistorySize: number;
}

// 🎮 命令调用器
export class CommandInvoker {
  private history: CommandHistory = {
    commands: [],
    currentIndex: -1,
    maxHistorySize: 50
  };

  // 执行命令
  async executeCommand(command: Command): Promise<CommandResult> {
    try {
      const result = await command.execute();

      if (result.success && command.canUndo) {
        // 清除当前位置之后的历史记录
        this.history.commands = this.history.commands.slice(0, this.history.currentIndex + 1);

        // 添加新命令
        this.history.commands.push(command);
        this.history.currentIndex++;

        // 保持历史记录大小限制
        if (this.history.commands.length > this.history.maxHistorySize) {
          this.history.commands.shift();
          this.history.currentIndex--;
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  // 撤销操作
  async undo(): Promise<CommandResult> {
    if (this.history.currentIndex < 0) {
      return {
        success: false,
        error: 'No commands to undo',
        timestamp: Date.now()
      };
    }

    const command = this.history.commands[this.history.currentIndex];
    const result = await command.undo();

    if (result.success) {
      this.history.currentIndex--;
    }

    return result;
  }

  // 重做操作
  async redo(): Promise<CommandResult> {
    if (this.history.currentIndex >= this.history.commands.length - 1) {
      return {
        success: false,
        error: 'No commands to redo',
        timestamp: Date.now()
      };
    }

    const command = this.history.commands[this.history.currentIndex + 1];
    const result = await command.execute();

    if (result.success) {
      this.history.currentIndex++;
    }

    return result;
  }

  // 获取历史记录
  getHistory(): Command[] {
    return [...this.history.commands];
  }

  // 获取状态信息
  getStatus() {
    return {
      canUndo: this.history.currentIndex >= 0,
      canRedo: this.history.currentIndex < this.history.commands.length - 1,
      historySize: this.history.commands.length,
      currentIndex: this.history.currentIndex
    };
  }

  // 清除历史记录
  clearHistory(): void {
    this.history.commands = [];
    this.history.currentIndex = -1;
  }
}

// 🤖 AI命令解析器
export class AICommandParser {
  parseCommand(aiCommand: AICommand, context: any): Command | null {
    // 简化的命令解析实现
    // 实际实现中会根据不同的intent创建相应的Command对象

    const baseCommand = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: aiCommand.intent,
      description: `AI Command: ${aiCommand.intent}`,
      timestamp: Date.now(),
      canUndo: true
    };

    // 根据不同的intent返回相应的命令
    switch (aiCommand.intent) {
      case 'create_text_node':
        return {
          ...baseCommand,
          execute: async () => {
            // 实际的节点创建逻辑
            return { success: true, timestamp: Date.now() };
          },
          undo: async () => {
            // 实际的撤销逻辑
            return { success: true, timestamp: Date.now() };
          }
        };

      default:
        return {
          ...baseCommand,
          execute: async () => {
            return {
              success: false,
              error: `Unsupported command: ${aiCommand.intent}`,
              timestamp: Date.now()
            };
          },
          undo: async () => {
            return { success: true, timestamp: Date.now() };
          }
        };
    }
  }
}

// 🎯 基础命令抽象类
export abstract class BaseCommand implements Command {
  public readonly id: string;
  public readonly type: string;
  public readonly description: string;
  public readonly timestamp: number;
  public readonly canUndo: boolean = true;

  constructor(type: string, description: string) {
    this.id = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.type = type;
    this.description = description;
    this.timestamp = Date.now();
  }

  abstract execute(): Promise<CommandResult>;
  abstract undo(): Promise<CommandResult>;
}