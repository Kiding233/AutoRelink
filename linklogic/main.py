import tkinter as tk
from rectangle import ResizableRectangle
from arrow import Arrow

class MainApp:
    def __init__(self, root):
        self.root = root
        root.title("可调整大小的矩形与动态箭头")
        root.geometry("800x600")
        
        # 创建画布
        self.canvas = tk.Canvas(root, width=800, height=600, bg="white")
        self.canvas.pack(fill=tk.BOTH, expand=True)
        
        # 创建五个矩形
        self.rect1 = ResizableRectangle(self.canvas, 100, 100, 250, 200, color="lightblue", label="矩形1")
        self.rect2 = ResizableRectangle(self.canvas, 400, 300, 550, 450, color="lightgreen", label="矩形2")
        self.rect3 = ResizableRectangle(self.canvas, 600, 100, 750, 250, color="lightyellow", label="矩形3")
        self.rect4 = ResizableRectangle(self.canvas, 200, 350, 350, 500, color="lightpink", label="矩形4")
        self.rect5 = ResizableRectangle(self.canvas, 50, 350, 200, 500, color="#E6E6FA", label="矩形5")
        
        # 创建箭头，从矩形1指向其他矩形
        self.arrow1_2 = Arrow(self.canvas, self.rect1, self.rect2)
        self.arrow1_3 = Arrow(self.canvas, self.rect1, self.rect3)
        self.arrow1_4 = Arrow(self.canvas, self.rect1, self.rect4)
        self.arrow1_5 = Arrow(self.canvas, self.rect1, self.rect5)
        
        # 创建控制面板
        self.create_control_panel()
        
        # 设置定时器，定期更新箭头
        self.update_arrow()
    
    def create_control_panel(self):
        """创建控制面板"""
        panel = tk.Frame(self.root, bg="lightgray", padx=10, pady=10)
        panel.pack(side=tk.BOTTOM, fill=tk.X)
        
        # 最短路径按钮
        tk.Button(panel, text="设置为最短路径", bg="lightblue", command=self.on_shortest_path).grid(row=0, column=0, columnspan=6, padx=5, pady=10, sticky=tk.EW)
    
    def on_shortest_path(self):
        """处理设置最短路径事件"""
        # 设置所有从矩形1出发的箭头为最短路径
        self.arrow1_2.set_shortest_path()
        self.arrow1_3.set_shortest_path()
        self.arrow1_4.set_shortest_path()
        self.arrow1_5.set_shortest_path()
    
    def update_arrow(self):
        """定期更新箭头位置"""
        self.arrow1_2.update()
        self.arrow1_3.update()
        self.arrow1_4.update()
        self.arrow1_5.update()
        # 每10毫秒更新一次
        self.root.after(10, self.update_arrow)
    
    def resize_canvas(self, event):
        """处理窗口大小改变事件"""
        self.canvas.config(width=event.width, height=event.height-100)  # 减去控制面板的高度
        self.update_arrow()

if __name__ == "__main__":
    root = tk.Tk()
    app = MainApp(root)
    root.mainloop()