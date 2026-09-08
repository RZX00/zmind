// 🎯 Canvas命令服务
// 连接Command Pattern与Canvas组件的桥梁

import { CommandInvoker, AICommandParser, type AICommand, type CommandResult } from '../patterns/CommandPattern';
import type { CanvasNode, CanvasConnection, Canvas } from '../types/canvas';

// 📍 局部类型定义
interface Position { x: number; y: number; }
interface Size { width: number; height: number; }

// 🎨 Canvas上下文接口定义
export interface CanvasCommandContext {
  // 节点操作
  onCreateNode: (node: Omit<CanvasNode, 'id'>) => string;
  onUpdateContent: (nodeId: string, content: any) => void;
  onGetContent: (nodeId: string) => any;
  onMoveNode: (nodeId: string, position: Position) => void;
  onGetPosition: (nodeId: string) => Position;
  onResizeNode: (nodeId: string, size: Size) => void;
  onGetSize: (nodeId: string) => Size;
  onDeleteNode: (nodeId: string) => void;
  onGetNode: (nodeId: string) => CanvasNode | undefined;
  onRestoreNode: (node: CanvasNode) => void;
  
  // 连接操作
  onCreateConnection: (connection: Omit<CanvasConnection, 'id'>) => string;
  onDeleteConnection: (connectionId: string) => void;
  onGetConnection: (connectionId: string) => CanvasConnection | undefined;
  
  // 画布状态
  getCanvas: () => Canvas;
  updateCanvas: (canvas: Canvas) => void;
}

// 🎯 Canvas命令服务类
export class CanvasCommandService {
  private commandInvoker = new CommandInvoker();
  private aiCommandParser = new AICommandParser();
  private context?: CanvasCommandContext;

  // 🔗 绑定Canvas上下文
  bindContext(context: CanvasCommandContext): void {
    this.context = context;
  }

  // 🚀 执行AI命令
  async executeAICommand(aiCommand: AICommand): Promise<CommandResult> {
    if (!this.context) {
      return {
        success: false,
        error: 'Canvas上下文未绑定',
        timestamp: Date.now()
      };
    }

    const command = this.aiCommandParser.parseCommand(aiCommand, this.context);
    if (!command) {
      return {
        success: false,
        error: `无法解析AI命令: ${aiCommand.intent}`,
        timestamp: Date.now()
      };
    }

    return await this.commandInvoker.executeCommand(command);
  }

  // ↶ 撤销操作
  async undo(): Promise<CommandResult> {
    return await this.commandInvoker.undo();
  }

  // ↷ 重做操作
  async redo(): Promise<CommandResult> {
    return await this.commandInvoker.redo();
  }

  // 📊 获取操作历史
  getHistory() {
    return this.commandInvoker.getHistory();
  }

  // 📝 获取状态信息
  getStatus() {
    return this.commandInvoker.getStatus();
  }

  // 🧹 清除历史记录
  clearHistory(): void {
    this.commandInvoker.clearHistory();
  }

  // 🎨 快捷方法：创建文本节点
  async createTextNode(content: string, position?: Position, size?: Size): Promise<CommandResult> {
    return await this.executeAICommand({
      intent: 'create_text_node',
      parameters: {
        content,
        position: position || { x: 100, y: 100 },
        size: size || { width: 200, height: 100 }
      }
    });
  }

  // 💻 快捷方法：创建代码节点
  async createCodeNode(
    content: string, 
    codeType: string = 'javascript', 
    position?: Position, 
    size?: Size
  ): Promise<CommandResult> {
    return await this.executeAICommand({
      intent: 'create_code_node',
      parameters: {
        content,
        codeType,
        position: position || { x: 100, y: 100 },
        size: size || { width: 300, height: 200 }
      }
    });
  }

  // 📝 快捷方法：更新节点内容
  async updateNodeContent(nodeId: string, content: any): Promise<CommandResult> {
    return await this.executeAICommand({
      intent: 'update_node_content',
      parameters: { nodeId, content }
    });
  }

  // 📐 快捷方法：移动节点
  async moveNode(nodeId: string, position: Position): Promise<CommandResult> {
    return await this.executeAICommand({
      intent: 'move_node',
      parameters: { nodeId, position }
    });
  }

  // 🗑️ 快捷方法：删除节点
  async deleteNode(nodeId: string): Promise<CommandResult> {
    return await this.executeAICommand({
      intent: 'delete_node',
      parameters: { nodeId }
    });
  }

  // 🔗 快捷方法：创建连接
  async createConnection(
    sourceNodeId: string, 
    targetNodeId: string, 
    connectionType: string = 'default'
  ): Promise<CommandResult> {
    return await this.executeAICommand({
      intent: 'create_connection',
      parameters: { sourceNodeId, targetNodeId, connectionType }
    });
  }

  // 🤖 批量执行AI命令
  async executeBatchAICommands(commands: AICommand[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    
    for (const command of commands) {
      const result = await this.executeAICommand(command);
      results.push(result);
      
      // 如果有命令失败，可以选择继续或停止
      if (!result.success) {
        console.warn(`批量命令执行失败:`, command, result.error);
        // 可以根据需要决定是否继续执行后续命令
      }
    }
    
    return results;
  }

  // 🔍 查询画布状态
  getCanvasSnapshot(): Canvas | null {
    return this.context?.getCanvas() || null;
  }

  // 📋 导出命令历史（用于调试或持久化）
  exportHistory(): string {
    const history = this.getHistory();
    return JSON.stringify({
      timestamp: Date.now(),
      commands: history.map(cmd => ({
        id: cmd.id,
        type: cmd.type,
        description: cmd.description,
        timestamp: cmd.timestamp,
        canUndo: cmd.canUndo
      }))
    }, null, 2);
  }
}

// 🎯 创建全局服务实例
export const canvasCommandService = new CanvasCommandService();

// 🎨 AI命令构建器辅助函数
export const AICommands = {
  createTextNode: (content: string, position?: Position, size?: Size): AICommand => ({
    intent: 'create_text_node',
    parameters: { content, position, size }
  }),

  createCodeNode: (content: string, codeType: string, position?: Position, size?: Size): AICommand => ({
    intent: 'create_code_node',
    parameters: { content, codeType, position, size }
  }),

  updateContent: (nodeId: string, content: any): AICommand => ({
    intent: 'update_node_content',
    parameters: { nodeId, content }
  }),

  moveNode: (nodeId: string, position: Position): AICommand => ({
    intent: 'move_node',
    parameters: { nodeId, position }
  }),

  deleteNode: (nodeId: string): AICommand => ({
    intent: 'delete_node',
    parameters: { nodeId }
  }),

  createConnection: (sourceNodeId: string, targetNodeId: string, connectionType?: string): AICommand => ({
    intent: 'create_connection',
    parameters: { sourceNodeId, targetNodeId, connectionType }
  })
};
