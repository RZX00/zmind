// 🎨 Mermaid节点图形化编辑器
// 集成现有的MermaidWorkspace，提供图形化编辑体验

import React, { useState, useCallback, useEffect } from 'react';
import { canvasLog, debugLog } from '../../utils/devLogger';
import MermaidRenderer from '../mermaid/MermaidRenderer';
import type { Canvas, CanvasNode, FontStyle } from '../../types/canvas';

interface MermaidNodeEditorProps {
  node: CanvasNode;
  editing?: boolean;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  fontStyle?: FontStyle;
  readOnly?: boolean;
  mermaidTheme?: any;  // ✅ 添加主题配置支持
  mermaidThemeId?: string; // ✅ 主题ID，用于mindmap调色板
}

// 🎨 Mermaid图形化编辑器
export const MermaidNodeEditor: React.FC<MermaidNodeEditorProps> = ({
  node,
  editing = false,
  onContentChange,
  readOnly = false,
  mermaidTheme,  // ✅ 接收主题配置
  mermaidThemeId
}) => {
  const [isEditMode, setIsEditMode] = useState(editing);
  const [localContent, setLocalContent] = useState(node.content);
  const allowAutoFix = !editing && !readOnly;

  // 🎯 同步外部编辑状态
  useEffect(() => {
    setIsEditMode(editing);
  }, [editing]);

  // 🎯 同步外部内容变化
  useEffect(() => {
    if (node.content !== localContent && !isEditMode) {
      setLocalContent(node.content);
    }
  }, [node.content, localContent, isEditMode]);

  // 🎯 增强的Mermaid编辑回调函数，支持完整双向编辑
  const handleConnectionChange = useCallback((changeInfo: string) => {
    debugLog('🔗 处理连线变更:', changeInfo);
    
    // 解析连线变更信息格式: CONNECTION_CHANGE:A->D:REPLACE:A->C
    const parts = changeInfo.split(':');
    if (parts.length !== 4 || parts[0] !== 'CONNECTION_CHANGE') {
      console.error('❌ 连线变更信息格式错误:', changeInfo);
      return;
    }
    
    const newConnection = parts[1]; // A->D
    const action = parts[2]; // REPLACE
    const oldConnection = parts[3]; // A->C
    
    if (action === 'REPLACE') {
      const [fromNode, toNode] = oldConnection.split('->');
      const [newFromNode, newToNode] = newConnection.split('->');
      
      let newCode = localContent;
      
      // 智能连线替换：支持多种连线格式
      const patterns = [
        { regex: new RegExp(`${fromNode}\\s*-->\\s*${toNode}`, 'g'), replacement: `${newFromNode} --> ${newToNode}` },
        { regex: new RegExp(`${fromNode}\\s*-\\.->\\s*${toNode}`, 'g'), replacement: `${newFromNode} -.-> ${newToNode}` },
        { regex: new RegExp(`${fromNode}\\[([\\s\\S]*?)\\]\\s*-->\\s*${toNode}\\[([\\s\\S]*?)\\]`, 'g'), replacement: `${newFromNode}[$1] --> ${newToNode}[$2]` },
        { regex: new RegExp(`${fromNode}\\[([\\s\\S]*?)\\]\\s*-\\.->\\s*${toNode}\\[([\\s\\S]*?)\\]`, 'g'), replacement: `${newFromNode}[$1] -.-> ${newToNode}[$2]` }
      ];
      
      for (const pattern of patterns) {
        if (pattern.regex.test(newCode)) {
          newCode = newCode.replace(pattern.regex, pattern.replacement);
          break;
        }
      }
      
      setLocalContent(newCode);
      onContentChange?.(node.id, newCode);
      canvasLog.debug('✅ 连线变更已保存:', newCode);
    }
  }, [localContent, node.id, onContentChange]);

  // 🆕 处理新节点创建
  const handleNewNodeCreation = useCallback((nodeInfo: string) => {
    debugLog('🆕 处理新节点创建:', nodeInfo);
    
    // 解析节点信息格式: NEW_NODE:F:新节点内容:x:y
    const parts = nodeInfo.split(':');
    if (parts.length !== 5 || parts[0] !== 'NEW_NODE') {
      console.error('❌ 新节点信息格式错误:', nodeInfo);
      return;
    }
    
    const newNodeId = parts[1];
    const content = parts[2];
    
    // 在mermaid代码末尾添加新节点
    const newNodeLine = `    ${newNodeId}[${content}]`;
    const newCode = localContent + '\n' + newNodeLine;
    
    setLocalContent(newCode);
    onContentChange?.(node.id, newCode);
    canvasLog.debug('✅ 新节点创建已保存:', newCode);
  }, [localContent, node.id, onContentChange]);

  // 🎯 提取连线现有标签的函数
  const extractExistingLabel = useCallback((fromNode: string, toNode: string): string => {
    const lines = localContent.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 匹配带标签的连线格式: A -->|标签| B, A -.->|标签| B
      const labelPatterns = [
        new RegExp(`${fromNode}\\s*-->\\s*\\|([^|]+)\\|\\s*${toNode}`, 'i'),
        new RegExp(`${fromNode}\\s*-\\.-\\s*>\\s*\\|([^|]+)\\|\\s*${toNode}`, 'i'),
        new RegExp(`${fromNode}\\[([^\\]]+)\\]\\s*-->\\s*\\|([^|]+)\\|\\s*${toNode}`, 'i'),
        new RegExp(`${fromNode}\\s*-->\\s*\\|([^|]+)\\|\\s*${toNode}\\[([^\\]]+)\\]`, 'i')
      ];
      
      for (const pattern of labelPatterns) {
        const match = trimmedLine.match(pattern);
        if (match) {
          const label = match[1] || match[2]; // 取第一个或第二个捕获组中的标签
          debugLog(`🎯 找到现有标签: "${label}" 在行: ${trimmedLine}`);
          return label;
        }
      }
    }
    
    debugLog(`❌ 未找到连线 ${fromNode} -> ${toNode} 的现有标签`);
    return '';
  }, [localContent]);

  // 🆕 处理获取连线标签请求
  const handleGetConnectionLabel = useCallback((labelInfo: string) => {
    debugLog('🔍 处理获取连线标签请求:', labelInfo);
    
    const connection = labelInfo.replace('GET_CONNECTION_LABEL:', '');
    const [fromNode, toNode] = connection.split('->');
    const existingLabel = extractExistingLabel(fromNode, toNode);
    
    debugLog(`🏷️ 提取到的标签: "${existingLabel}" (${fromNode} -> ${toNode})`);
    return existingLabel;
  }, [extractExistingLabel]);

  // 🆕 处理连线标签编辑
  const handleConnectionLabelEdit = useCallback((labelInfo: string) => {
    debugLog('🆕 处理连线标签编辑:', labelInfo);
    
    // 解析标签信息格式: CONNECTION_LABEL:A->B:标签文字
    const parts = labelInfo.split(':');
    if (parts.length !== 3 || parts[0] !== 'CONNECTION_LABEL') {
      console.error('❌ 连线标签信息格式错误:', labelInfo);
      return;
    }
    
    const connection = parts[1]; // A->B
    const labelText = parts[2];
    const [fromNode, toNode] = connection.split('->');
    
    let newCode = localContent;
    const lines = newCode.split('\n');
    let connectionFound = false;
    
    debugLog(`🔍 寻找连线: ${fromNode} -> ${toNode}`);
    debugLog('📄 当前代码行:', lines);
    
    // 🎯 增强的连线匹配模式 - 支持所有可能的格式
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 🎯 全面的连线匹配模式
      const connectionPatterns = [
        // 1. 已有标签的连线: A -->|现有标签| B, A -->|现有标签| B[文字]  
        {
          regex: new RegExp(`(${fromNode}(?:\\[[^\\]]*\\])?\\s*-->\\s*)\\|([^|]+)\\|(\\s*${toNode}(?:\\[[^\\]]*\\])?)`, 'i'),
          type: 'labeled-solid',
          handler: (match: RegExpMatchArray) => {
            const prefix = match[1]; // "B --> "
            const suffix = match[3]; // " D[跳过]"
            debugLog(`🎯 找到带标签连线，更新为新标签: ${labelText}`);
            return labelText ? `${prefix}|${labelText}|${suffix}` : `${prefix}${suffix}`;
          }
        },
        // 2. 已有标签的虚线: A -.->|现有标签| B  
        {
          regex: new RegExp(`(${fromNode}(?:\\[[^\\]]*\\])?\\s*-\\.->\\s*)\\|([^|]+)\\|(\\s*${toNode}(?:\\[[^\\]]*\\])?)`, 'i'),
          type: 'labeled-dotted',
          handler: (match: RegExpMatchArray) => {
            const prefix = match[1];
            const suffix = match[3];
            return labelText ? `${prefix}|${labelText}|${suffix}` : `${prefix}${suffix}`;
          }
        },
        // 3. 无标签连线: A --> B, A --> B[文字], A[文字] --> B, A[文字] --> B[文字]
        {
          regex: new RegExp(`(${fromNode}(?:\\[[^\\]]*\\])?\\s*-->\\s*${toNode}(?:\\[[^\\]]*\\])?)`, 'i'),
          type: 'unlabeled-solid',
          handler: (match: RegExpMatchArray) => {
            const fullMatch = match[1];
            debugLog(`🎯 找到无标签连线，添加标签: ${labelText}`);
            return labelText ? fullMatch.replace('-->', `-->|${labelText}|`) : fullMatch;
          }
        },
        // 4. 无标签虚线: A -.-> B
        {
          regex: new RegExp(`(${fromNode}(?:\\[[^\\]]*\\])?\\s*-\\.->\\s*${toNode}(?:\\[[^\\]]*\\])?)`, 'i'),
          type: 'unlabeled-dotted',
          handler: (match: RegExpMatchArray) => {
            const fullMatch = match[1];
            return labelText ? fullMatch.replace('-.', `-.->|${labelText}|`) : fullMatch;
          }
        }
      ];
      
      for (const pattern of connectionPatterns) {
        const match = line.match(pattern.regex);
        if (match) {
          debugLog(`✅ 找到匹配的连线 (${pattern.type}): "${line}"`);
          debugLog(`🎯 匹配组:`, match);
          connectionFound = true;
          
          // 使用对应的处理函数生成新行
          const newLineContent = pattern.handler(match);
          lines[i] = line.replace(match[0], newLineContent);
          
          debugLog(`🔄 连线更新: "${line}" -> "${lines[i]}"`);
          break;
        }
      }
      
      if (connectionFound) break;
    }
    
    // 如果没有找到连线，创建新的连线
    if (!connectionFound) {
      debugLog(`⚠️ 连线 ${fromNode} -> ${toNode} 不存在，创建新连线`);
      const newConnectionLine = labelText 
        ? `    ${fromNode} -->|${labelText}| ${toNode}`
        : `    ${fromNode} --> ${toNode}`;
      lines.push(newConnectionLine);
      debugLog(`➕ 添加新连线:`, newConnectionLine);
    }
    
    newCode = lines.join('\n');
    setLocalContent(newCode);
    onContentChange?.(node.id, newCode);
    canvasLog.debug('✅ 新节点创建已保存:', newCode);
  }, [localContent, node.id, onContentChange]);

  // 🆕 处理新连线创建
  const handleNewConnectionCreation = useCallback((connectionInfo: string) => {
    debugLog('🆕 处理新连线创建:', connectionInfo);
    
    // 解析连线信息格式: NEW_CONNECTION:A->B
    const parts = connectionInfo.split(':');
    if (parts.length !== 2 || parts[0] !== 'NEW_CONNECTION') {
      console.error('❌ 新连线信息格式错误:', connectionInfo);
      return;
    }
    
    const connection = parts[1]; // A->B
    const [fromNode, toNode] = connection.split('->');
    
    // 🚫 检查是否为自连接
    if (fromNode === toNode) {
      return;
    }
    
    // 在mermaid代码末尾添加新连线
    const newConnectionLine = `    ${fromNode} --> ${toNode}`;
    const newCode = localContent + '\n' + newConnectionLine;
    
    setLocalContent(newCode);
    onContentChange?.(node.id, newCode);
    canvasLog.debug('✅ 新节点创建已保存:', newCode);
  }, [localContent, node.id, onContentChange]);

  // 🆕 处理新节点和连线创建
  const handleNewNodeAndConnect = useCallback((nodeAndConnectionInfo: string) => {
    debugLog('🆕 处理新节点和连线创建:', nodeAndConnectionInfo);
    
    // 解析信息格式: NEW_NODE_AND_CONNECT:F:新节点内容:A:x:y
    const parts = nodeAndConnectionInfo.split(':');
    if (parts.length !== 6 || parts[0] !== 'NEW_NODE_AND_CONNECT') {
      console.error('❌ 新节点和连线信息格式错误:', nodeAndConnectionInfo);
      return;
    }
    
    const newNodeId = parts[1];
    const content = parts[2];
    const fromNode = parts[3];
    
    // 🔍 检查是否已存在该节点，避免重复添加
    if (localContent.includes(`${newNodeId}[`)) {
      return;
    }
    
    // 添加新节点和连线
    const newNodeLine = `    ${newNodeId}[${content}]`;
    const newConnectionLine = `    ${fromNode} --> ${newNodeId}`;
    const newCode = localContent + '\n' + newNodeLine + '\n' + newConnectionLine;
    
    setLocalContent(newCode);
    onContentChange?.(node.id, newCode);
    canvasLog.debug('✅ 新节点创建已保存:', newCode);
  }, [localContent, node.id, onContentChange]);

  // 🔍 检测图表类型
  const detectDiagramType = useCallback((code: string) => {
    const trimmedCode = code.trim();
    if (trimmedCode.startsWith('flowchart') || trimmedCode.startsWith('graph')) return 'flowchart';
    if (trimmedCode.startsWith('sequenceDiagram')) return 'sequence';
    if (trimmedCode.startsWith('mindmap')) return 'mindmap';
    if (trimmedCode.startsWith('classDiagram')) return 'class';
    if (trimmedCode.startsWith('stateDiagram')) return 'state';
    return 'flowchart'; // 默认流程图
  }, []);

  // 📝 智能更新Mermaid内容
  const updateMermaidContent = useCallback((nodeId: string, newContent: string) => {
    debugLog('📝 更新节点内容', { nodeId, newContent });
    
    // 检测图表类型
    const diagramType = detectDiagramType(localContent);
    let newCode = localContent;
    
    if (diagramType === 'flowchart') {
      // 流程图：智能检测并替换所有节点形状
      const nodeShapes = [
        // 方括号节点 [内容]
        { regex: new RegExp(`(${nodeId})\\[([^\\]]+)\\]`, 'g'), replacement: `$1[${newContent}]` },
        // 花括号节点 {内容} (菱形)
        { regex: new RegExp(`(${nodeId})\\{([^}]+)\\}`, 'g'), replacement: `$1{${newContent}}` },
        // 圆括号节点 (内容) (圆形)
        { regex: new RegExp(`(${nodeId})\\(([^)]+)\\)`, 'g'), replacement: `$1(${newContent})` },
        // 双圆括号节点 ((内容)) (椭圆)
        { regex: new RegExp(`(${nodeId})\\(\\(([^)]+)\\)\\)`, 'g'), replacement: `$1((${newContent}))` },
        // 双方括号节点 [[内容]] (子程序)
        { regex: new RegExp(`(${nodeId})\\[\\[([^\\]]+)\\]\\]`, 'g'), replacement: `$1[[${newContent}]]` },
        // 圆柱形节点 [(内容)]
        { regex: new RegExp(`(${nodeId})\\[\\(([^)]+)\\)\\]`, 'g'), replacement: `$1[(${newContent})]` },
        // 六边形节点 {{内容}}
        { regex: new RegExp(`(${nodeId})\\{\\{([^}]+)\\}\\}`, 'g'), replacement: `$1{{${newContent}}}` },
        // 平行四边形节点 [/内容/]
        { regex: new RegExp(`(${nodeId})\\[/([^/]+)/\\]`, 'g'), replacement: `$1[/${newContent}/]` },
        // 梯形节点 [\\内容/]
        { regex: new RegExp(`(${nodeId})\\[\\\\([^/]+)/\\]`, 'g'), replacement: `$1[\\\\${newContent}/]` },
        // 倒梯形节点 [/内容\\]
        { regex: new RegExp(`(${nodeId})\\[/([^\\\\]+)\\\\\\]`, 'g'), replacement: `$1[/${newContent}\\\\]` }
      ];

      // 尝试匹配并替换
      let matched = false;
      for (const shape of nodeShapes) {
        // 重新创建正则表达式以重置状态
        const testRegex = new RegExp(shape.regex.source, shape.regex.flags);
        const match = newCode.match(testRegex);
        if (match) {
          const originalText = match[0];
          newCode = newCode.replace(shape.regex, shape.replacement);
          matched = true;
          debugLog(`🎯 匹配到节点形状并替换: "${originalText}" -> "${nodeId}{${newContent}}" (样式保持)`);
          break;
        }
      }

      // 如果没有匹配到任何形状，说明是纯文本节点，直接替换
      if (!matched) {
        const textNodeRegex = new RegExp(`\\b${nodeId}\\b`, 'g');
        newCode = newCode.replace(textNodeRegex, newContent);
        debugLog(`🎯 作为纯文本节点替换: ${nodeId} -> ${newContent}`);
      }
    } else if (diagramType === 'sequence') {
      // 时序图：替换participant或actor的显示名称
      const participantAsRegex = new RegExp(`(participant\\s+\\w+\\s+as\\s+)${nodeId}`, 'gi');
      newCode = localContent.replace(participantAsRegex, `$1${newContent}`);
      
      const actorAsRegex = new RegExp(`(actor\\s+\\w+\\s+as\\s+)${nodeId}`, 'gi');
      newCode = newCode.replace(actorAsRegex, `$1${newContent}`);
    } else if (diagramType === 'mindmap') {
      // 思维导图：智能替换节点文本
      const lines = localContent.split('\n');
      const newLines = lines.map(line => {
        const trimmed = line.trim();
        
        if (trimmed === nodeId) {
          return line.replace(nodeId, newContent);
        }
        
        if (trimmed.includes(`((${nodeId}))`)) {
          return line.replace(`((${nodeId}))`, `((${newContent}))`);
        }
        
        const wordBoundaryRegex = new RegExp(`\\b${nodeId}\\b`, 'g');
        if (wordBoundaryRegex.test(line)) {
          return line.replace(wordBoundaryRegex, newContent);
        }
        
        return line;
      });
      newCode = newLines.join('\n');
    } else {
      // 其他类型：简单的文本替换
      newCode = localContent.replace(new RegExp(nodeId, 'g'), newContent);
    }
    
    setLocalContent(newCode);
    onContentChange?.(node.id, newCode);
    canvasLog.debug('✅ 新节点创建已保存:', newCode);
  }, [localContent, node.id, onContentChange, detectDiagramType]);

  

  const handleMermaidNodeEdit = useCallback((nodeId: string, newContent: string) => {
    debugLog('🎯 Mermaid图形编辑回调', { nodeId, newContent });
    
    // 🔗 处理连线变更（特殊格式）
    if (nodeId === '__CONNECTION__') {
      handleConnectionChange(newContent);
      return;
    }
    
    // 🆕 处理新节点创建
    if (nodeId === '__NEW_NODE__') {
      handleNewNodeCreation(newContent);
      return;
    }
    
    // 🆕 处理获取连线标签请求
    if (nodeId === '__GET_CONNECTION_LABEL__') {
      const existingLabel = handleGetConnectionLabel(newContent);
      debugLog(`🔄 返回连线标签: "${existingLabel}"`);
      return;
    }
    
    // 🆕 处理连线标签编辑
    if (nodeId === '__CONNECTION_LABEL__') {
      handleConnectionLabelEdit(newContent);
      return;
    }
    
    // 🆕 处理新连线创建
    if (nodeId === '__NEW_CONNECTION__') {
      handleNewConnectionCreation(newContent);
      return;
    }
    
    // 🆕 处理新节点和连线创建
    if (nodeId === '__NEW_NODE_AND_CONNECT__') {
      handleNewNodeAndConnect(newContent);
      return;
    }
    
    // 📝 处理普通节点内容变更 - 智能检测图表类型并更新
    updateMermaidContent(nodeId, newContent);
  }, [
    handleConnectionChange,
    handleConnectionLabelEdit,
    handleGetConnectionLabel,
    handleNewConnectionCreation,
    handleNewNodeAndConnect,
    handleNewNodeCreation,
    updateMermaidContent,
  ]);

  // 🔗 处理连线变更的函数
  

  return (
    <div className="w-full h-full relative bg-transparent">

      {/* 🎯 Mermaid图形编辑器 - 永远使用图形编辑模式 */}
      <div className="w-full h-full relative">
        {/* 📖 图形编辑模式 */}
        <div className="w-full h-full">
          {node.content.trim() ? (
            <MermaidRenderer 
              code={localContent}
              height="100%"
              className="w-full h-full overflow-hidden"
              isEditMode={true}
              allowAutoFix={allowAutoFix}
              onAutoFix={(fixedCode) => {
                setLocalContent(fixedCode);
                onContentChange?.(node.id, fixedCode);
              }}
              mermaidTheme={(() => {
                // 📊 调试信息（已禁用以优化性能）
                // debugLog('📊 MermaidNodeEditor: 接收到mermaidTheme:', mermaidTheme);
                return mermaidTheme;
              })()}  // ✅ 传递主题配置并添加debug
              mermaidThemeId={mermaidThemeId}
              onNodeEdit={handleMermaidNodeEdit}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-zinc-500 italic">
              <div className="text-center">
                <div>点击开始编辑Mermaid图表</div>
                <div className="text-xs mt-1">支持流程图、时序图等图形编辑</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MermaidNodeEditor;
