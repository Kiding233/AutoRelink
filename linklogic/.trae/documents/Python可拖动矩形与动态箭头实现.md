# 实现计划

## 1. 技术选型

* 使用Python标准库`Tkinter`实现GUI界面

* 利用`Canvas`组件绘制矩形和箭头

## 2. 核心功能实现

### 2.1 可拖动、可调整大小的矩形类

* 创建`ResizableRectangle`类，继承自Tkinter组件

* 实现鼠标事件处理：

  * 左键拖动移动矩形

  * 右键或特定控制点调整矩形大小

  * 支持四个角和四条边的调整

### 2.2 矩形位置与大小属性

* 每个矩形包含位置(x, y)和大小(width, height)属性

* 计算并维护矩形的中心点坐标

* 计算并维护四条边的中心点坐标

### 2.3 箭头绘制功能

* 创建`Arrow`类，负责绘制和更新箭头

* 支持从一个矩形的特定点指向另一个矩形的特定点

* 可配置的箭头样式（颜色、宽度、箭头头大小）

### 2.4 箭头连接点配置

* 支持从以下点连接：

  * 矩形中心点

  * 矩形四条边的中心点

* 默认从矩形1的中心点指向矩形2的中心点

### 2.5 交互更新机制

* 当矩形位置或大小改变时，自动更新箭头位置

* 实时重绘箭头，保持连接状态

## 3. 代码结构

```python
# main.py
import tkinter as tk
from rectangle import ResizableRectangle
from arrow import Arrow

# 主窗口类
class MainWindow:
    def __init__(self, root):
        self.root = root
        self.canvas = tk.Canvas(root, width=800, height=600)
        self.canvas.pack()
        
        # 创建两个矩形
        self.rect1 = ResizableRectangle(self.canvas, 100, 100, 200, 150, fill="lightblue")
        self.rect2 = ResizableRectangle(self.canvas, 400, 200, 150, 200, fill="lightgreen")
        
        # 创建箭头，默认中心点到中心点
        self.arrow = Arrow(self.canvas, self.rect1, self.rect2)
        
        # 绑定更新事件
        self.canvas.bind("<Configure>", self.update_arrow)
        
    def update_arrow(self, event=None):
        self.arrow.update()

# 运行主程序
if __name__ == "__main__":
    root = tk.Tk()
    root.title("可拖动矩形与箭头")
    app = MainWindow(root)
    root.mainloop()
```

```python
# rectangle.py
import tkinter as tk

class ResizableRectangle:
    def __init__(self, canvas, x, y, width, height, fill="white"):
        # 初始化矩形属性
        # 实现鼠标事件绑定
        # 绘制矩形和控制点
        
    def get_center(self):
        # 返回矩形中心点坐标
        
    def get_edge_center(self, edge):
        # 返回指定边的中心点坐标（edge: 'top', 'bottom', 'left', 'right'）
        
    def move(self, dx, dy):
        # 移动矩形
        
    def resize(self, new_width, new_height):
        # 调整矩形大小
        
    # 鼠标事件处理方法
    def on_press(self, event):
        # 处理鼠标按下事件
        
    def on_drag(self, event):
        # 处理鼠标拖动事件
        
    def on_release(self, event):
        # 处理鼠标释放事件
```

```python
# arrow.py
import tkinter as tk

class Arrow:
    def __init__(self, canvas, rect1, rect2, 
                 from_point="center", to_point="center",
                 color="black", width=2, arrow_size=10):
        # 初始化箭头属性
        # 绘制初始箭头
        
    def update(self):
        # 更新箭头位置和方向
        
    def set_from_point(self, point):
        # 设置起始点类型（center, top, bottom, left, right）
        
    def set_to_point(self, point):
        # 设置目标点类型（center, top, bottom, left, right）
        
    def get_point_coords(self, rect, point_type):
        # 获取矩形指定点的坐标
        
    def draw_arrow(self, x1, y1, x2, y2):
        # 绘制箭头
```

## 4. 实现步骤

1. 首先创建`rectangle.py`，实现可拖动、可调整大小的矩形类
2. 然后创建`arrow.py`，实现箭头绘制和更新功能
3. 最后创建`main.py`，整合矩形和箭头，实现完整的应用程序
4. 测试所有功能，确保矩形可以拖动、调整大小，箭头可以正确更新

## 5. 预期效果

* 窗口中显示两个不同颜色的矩形

* 鼠标左键拖动矩形可移动位置

* 鼠标在矩形边缘或角落拖动可调整大小

* 矩形之间显示一个箭头，默认从中心点指向中心点

* 当矩形位置或大小改变时，箭头自动更新

* 支持通过代码配置箭头的起始点和目标点

## 6. 后续扩展建议

* 添加UI控件，让用户可以交互选择箭头的连接点

* 支持多个箭头连接

* 添加矩形的旋转功能

* 支持保存和加载图形配置

