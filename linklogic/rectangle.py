import tkinter as tk

class ResizableRectangle:
    def __init__(self, canvas, x1, y1, x2, y2, color="blue", label=""):
        self.canvas = canvas
        self.color = color
        self.label = label
        self.resizing = False
        self.dragging = False
        self.resize_edge = None
        
        # 创建矩形
        self.rect = canvas.create_rectangle(x1, y1, x2, y2, fill=color, outline="black", width=2)
        
        # 创建标签
        self.text = canvas.create_text((x1+x2)//2, (y1+y2)//2, text=label, fill="black", font=("Arial", 10))
        
        # 绑定事件
        canvas.tag_bind(self.rect, "<Button-1>", self.on_left_click)
        canvas.tag_bind(self.rect, "<Button-3>", self.on_right_click)
        canvas.tag_bind(self.rect, "<B1-Motion>", self.on_drag)
        canvas.tag_bind(self.rect, "<ButtonRelease-1>", self.on_release)
        
        # 记录初始位置和大小
        self.x1, self.y1, self.x2, self.y2 = x1, y1, x2, y2
        self.original_pos = (x1, y1, x2, y2)
    
    def get_center(self):
        """获取矩形中心点坐标"""
        return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)
    
    def get_edge_center(self, edge):
        """获取矩形指定边的中心点坐标
        edge: "top", "bottom", "left", "right"
        """
        if edge == "top":
            return ((self.x1 + self.x2) // 2, self.y1)
        elif edge == "bottom":
            return ((self.x1 + self.x2) // 2, self.y2)
        elif edge == "left":
            return (self.x1, (self.y1 + self.y2) // 2)
        elif edge == "right":
            return (self.x2, (self.y1 + self.y2) // 2)
        else:
            return self.get_center()
    
    def get_pos(self):
        """获取矩形当前位置和大小"""
        return (self.x1, self.y1, self.x2, self.y2)
    
    def on_left_click(self, event):
        """处理左键点击事件"""
        # 获取点击位置
        x, y = event.x, event.y
        
        # 获取矩形当前位置
        self.x1, self.y1, self.x2, self.y2 = self.canvas.coords(self.rect)
        
        # 检查是否点击在边缘（用于调整大小）
        edge_threshold = 10
        
        # 检查点击位置是否在矩形的边缘
        if abs(x - self.x1) < edge_threshold and abs(y - self.y1) < edge_threshold:
            # 左上角
            self.resizing = True
            self.resize_edge = "nw"
        elif abs(x - self.x2) < edge_threshold and abs(y - self.y1) < edge_threshold:
            # 右上角
            self.resizing = True
            self.resize_edge = "ne"
        elif abs(x - self.x1) < edge_threshold and abs(y - self.y2) < edge_threshold:
            # 左下角
            self.resizing = True
            self.resize_edge = "sw"
        elif abs(x - self.x2) < edge_threshold and abs(y - self.y2) < edge_threshold:
            # 右下角
            self.resizing = True
            self.resize_edge = "se"
        elif abs(x - self.x1) < edge_threshold:
            # 左边
            self.resizing = True
            self.resize_edge = "w"
        elif abs(x - self.x2) < edge_threshold:
            # 右边
            self.resizing = True
            self.resize_edge = "e"
        elif abs(y - self.y1) < edge_threshold:
            # 上边
            self.resizing = True
            self.resize_edge = "n"
        elif abs(y - self.y2) < edge_threshold:
            # 下边
            self.resizing = True
            self.resize_edge = "s"
        else:
            # 点击在矩形内部，用于拖动
            self.dragging = True
            self.drag_start_x = x - self.x1
            self.drag_start_y = y - self.y1
    
    def on_right_click(self, event):
        """处理右键点击事件"""
        pass
    
    def on_drag(self, event):
        """处理拖动事件"""
        x, y = event.x, event.y
        
        if self.resizing:
            # 调整大小
            new_x1, new_y1, new_x2, new_y2 = self.x1, self.y1, self.x2, self.y2
            
            if self.resize_edge in ["n", "nw", "ne"]:
                new_y1 = y
            if self.resize_edge in ["s", "sw", "se"]:
                new_y2 = y
            if self.resize_edge in ["w", "nw", "sw"]:
                new_x1 = x
            if self.resize_edge in ["e", "ne", "se"]:
                new_x2 = x
            
            # 确保矩形有最小大小
            min_size = 20
            if new_x2 - new_x1 < min_size:
                if self.resize_edge in ["w", "nw", "sw"]:
                    new_x1 = new_x2 - min_size
                else:
                    new_x2 = new_x1 + min_size
            if new_y2 - new_y1 < min_size:
                if self.resize_edge in ["n", "nw", "ne"]:
                    new_y1 = new_y2 - min_size
                else:
                    new_y2 = new_y1 + min_size
            
            # 更新矩形位置
            self.canvas.coords(self.rect, new_x1, new_y1, new_x2, new_y2)
            
            # 更新标签位置
            self.canvas.coords(self.text, (new_x1 + new_x2) // 2, (new_y1 + new_y2) // 2)
            
            # 更新记录的位置
            self.x1, self.y1, self.x2, self.y2 = new_x1, new_y1, new_x2, new_y2
            
        elif self.dragging:
            # 拖动矩形
            new_x1 = x - self.drag_start_x
            new_y1 = y - self.drag_start_y
            new_x2 = new_x1 + (self.x2 - self.x1)
            new_y2 = new_y1 + (self.y2 - self.y1)
            
            # 更新矩形位置
            self.canvas.coords(self.rect, new_x1, new_y1, new_x2, new_y2)
            
            # 更新标签位置
            self.canvas.coords(self.text, (new_x1 + new_x2) // 2, (new_y1 + new_y2) // 2)
            
            # 更新记录的位置
            self.x1, self.y1, self.x2, self.y2 = new_x1, new_y1, new_x2, new_y2
    
    def on_release(self, event):
        """处理鼠标释放事件"""
        self.resizing = False
        self.dragging = False
        self.resize_edge = None
    
    def move_to(self, x1, y1, x2, y2):
        """移动矩形到指定位置"""
        self.canvas.coords(self.rect, x1, y1, x2, y2)
        self.canvas.coords(self.text, (x1 + x2) // 2, (y1 + y2) // 2)
        self.x1, self.y1, self.x2, self.y2 = x1, y1, x2, y2