// 📊 Markdown表格解析和生成工具
// 处理表格数据与Markdown语法之间的转换

export interface TableData {
  headers: string[];
  rows: string[][];
}

/**
 * 解析Markdown表格为数据结构
 * @param content Markdown表格内容
 * @returns 解析后的表格数据
 */
export function parseMarkdownTable(content: string): TableData {
  if (!content?.trim()) {
    // 返回默认空表格 3x3
    return createDefaultTable(3, 3);
  }

  try {
    const lines = content.trim().split('\n');
    
    // 至少需要2行（表头 + 分隔符）
    if (lines.length < 2) {
      return createDefaultTable(3, 3);
    }

    // 解析表头
    const headerLine = lines[0];
    const headers = headerLine
      .split('|')
      .slice(1, -1) // 移除首尾空元素
      .map(cell => cell.trim());

    // 跳过分隔符行，解析数据行
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
      const rowLine = lines[i];
      const cells = rowLine
        .split('|')
        .slice(1, -1) // 移除首尾空元素
        .map(cell => cell.trim());
      
      // 确保行的长度与表头一致
      while (cells.length < headers.length) {
        cells.push('');
      }
      cells.length = headers.length; // 截断多余的列
      
      rows.push(cells);
    }

    return { headers, rows };
  } catch (error) {
    console.warn('解析Markdown表格失败:', error);
    return createDefaultTable(3, 3);
  }
}

/**
 * 将表格数据生成Markdown格式
 * @param headers 表头数组
 * @param rows 数据行数组
 * @returns Markdown表格字符串
 */
export function generateMarkdownTable(headers: string[], rows: string[][]): string {
  if (!headers.length) {
    return createDefaultTableMarkdown(3, 3);
  }

  try {
    const lines: string[] = [];

    // 生成表头行
    const headerLine = '| ' + headers.join(' | ') + ' |';
    lines.push(headerLine);

    // 生成分隔符行
    const separatorLine = '|' + headers.map(() => '---|').join('') + '';
    lines.push(separatorLine);

    // 生成数据行
    rows.forEach(row => {
      // 确保行长度与表头一致
      const paddedRow = [...row];
      while (paddedRow.length < headers.length) {
        paddedRow.push('');
      }
      paddedRow.length = headers.length; // 截断多余的列

      const rowLine = '| ' + paddedRow.join(' | ') + ' |';
      lines.push(rowLine);
    });

    return lines.join('\n');
  } catch (error) {
    console.warn('生成Markdown表格失败:', error);
    return createDefaultTableMarkdown(3, 3);
  }
}

/**
 * 创建默认表格数据
 * @param columns 列数
 * @param rows 行数
 * @returns 默认表格数据
 */
export function createDefaultTable(columns: number, rows: number): TableData {
  const headers = new Array(columns).fill('');
  const tableRows = Array(rows).fill(null).map(() => new Array(columns).fill(''));
  
  return { headers, rows: tableRows };
}

/**
 * 创建默认Markdown表格
 * @param columns 列数
 * @param rows 行数
 * @returns 默认Markdown表格字符串
 */
export function createDefaultTableMarkdown(columns: number, rows: number): string {
  const { headers, rows: tableRows } = createDefaultTable(columns, rows);
  return generateMarkdownTable(headers, tableRows);
}

/**
 * 生成Excel风格的列标（A, B, C, ... AA, AB, ...）
 * @param index 列索引（从0开始）
 * @returns 列标字符串
 */
export function generateColumnLabel(index: number): string {
  let result = '';
  let num = index;
  do {
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);
  return result;
}

/**
 * 添加表格行
 * @param content 原Markdown内容
 * @param rowIndex 插入位置（-1表示末尾）
 * @returns 新的Markdown内容
 */
export function addTableRow(content: string, rowIndex: number = -1): string {
  const { headers, rows } = parseMarkdownTable(content);
  
  const newRow = new Array(headers.length).fill('');
  
  if (rowIndex === -1) {
    rows.push(newRow);
  } else {
    rows.splice(rowIndex, 0, newRow);
  }
  
  return generateMarkdownTable(headers, rows);
}

/**
 * 删除表格行
 * @param content 原Markdown内容
 * @param rowIndex 要删除的行索引
 * @returns 新的Markdown内容
 */
export function deleteTableRow(content: string, rowIndex: number): string {
  const { headers, rows } = parseMarkdownTable(content);
  
  if (rows.length <= 1 || rowIndex < 0 || rowIndex >= rows.length) {
    return content;
  }
  
  rows.splice(rowIndex, 1);
  return generateMarkdownTable(headers, rows);
}

/**
 * 添加表格列
 * @param content 原Markdown内容
 * @param colIndex 插入位置（-1表示末尾）
 * @returns 新的Markdown内容
 */
export function addTableColumn(content: string, colIndex: number = -1): string {
  const { headers, rows } = parseMarkdownTable(content);
  
  if (colIndex === -1) {
    headers.push('');
    rows.forEach(row => row.push(''));
  } else {
    headers.splice(colIndex, 0, '');
    rows.forEach(row => row.splice(colIndex, 0, ''));
  }
  
  return generateMarkdownTable(headers, rows);
}

/**
 * 删除表格列
 * @param content 原Markdown内容
 * @param colIndex 要删除的列索引
 * @returns 新的Markdown内容
 */
export function deleteTableColumn(content: string, colIndex: number): string {
  const { headers, rows } = parseMarkdownTable(content);
  
  if (headers.length <= 1 || colIndex < 0 || colIndex >= headers.length) {
    return content;
  }
  
  headers.splice(colIndex, 1);
  rows.forEach(row => row.splice(colIndex, 1));
  
  return generateMarkdownTable(headers, rows);
}

/**
 * 更新单元格内容
 * @param content 原Markdown内容
 * @param rowIndex 行索引（-1表示表头）
 * @param colIndex 列索引
 * @param value 新值
 * @returns 新的Markdown内容
 */
export function updateTableCell(content: string, rowIndex: number, colIndex: number, value: string): string {
  const { headers, rows } = parseMarkdownTable(content);
  
  if (rowIndex === -1) {
    // 更新表头
    if (colIndex >= 0 && colIndex < headers.length) {
      headers[colIndex] = value;
    }
  } else {
    // 更新数据行
    if (rowIndex >= 0 && rowIndex < rows.length && colIndex >= 0 && colIndex < headers.length) {
      rows[rowIndex][colIndex] = value;
    }
  }
  
  return generateMarkdownTable(headers, rows);
}