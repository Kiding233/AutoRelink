import tkinter as tk
import math

class Arrow:
    # 区域历史记录，用于记录每个矩形相对于其他矩形的区域变化
    # 键为 (rect1_id, rect2_id)，值为 (previous_region, current_region)
    region_history = {}
    
    @classmethod
    def update_region_history(cls, rect1, rect2, new_region):
        """更新区域历史记录，仅当区域改变时才更新
        
        Args:
            rect1: 矩形1对象
            rect2: 矩形2对象
            new_region: 新的区域
        """
        # 使用对象id作为键，确保唯一性
        key = (id(rect1), id(rect2))
        
        # 获取当前历史记录
        if key in cls.region_history:
            prev_region, curr_region = cls.region_history[key]
            # 仅当区域改变时才更新历史记录
            if new_region != curr_region:
                cls.region_history[key] = (curr_region, new_region)
        else:
            # 首次记录，前一个区域为空
            cls.region_history[key] = (None, new_region)
    
    @classmethod
    def get_region_history(cls, rect1, rect2):
        """获取区域历史记录
        
        Args:
            rect1: 矩形1对象
            rect2: 矩形2对象
            
        Returns:
            tuple: (previous_region, current_region)
        """
        key = (id(rect1), id(rect2))
        return cls.region_history.get(key, (None, None))
    
    def __init__(self, canvas, rect1, rect2, 
                 from_point=None, to_point=None,
                 color="black", width=2, arrow_size=10):
        """初始化箭头
        
        Args:
            canvas: 画布对象
            rect1: 起始矩形对象
            rect2: 目标矩形对象
            from_point: 起始点类型 (center, top, bottom, left, right)，None表示自动计算最短路径
            to_point: 目标点类型 (center, top, bottom, left, right)，None表示自动计算最短路径
            color: 箭头颜色
            width: 箭头线条宽度
            arrow_size: 箭头头大小
        """
        self.canvas = canvas
        self.rect1 = rect1
        self.rect2 = rect2
        self.color = color
        self.width = width
        self.arrow_size = arrow_size
        
        # 自动模式标志，True表示自动计算最短路径，False表示用户手动设置
        self.auto_mode = True
        
        # 如果未指定起始点或目标点，自动计算最短路径
        if from_point is None or to_point is None:
            self.from_point, self.to_point = self.calculate_shortest_points()
        else:
            self.from_point = from_point
            self.to_point = to_point
            self.auto_mode = False
        
        # 创建箭头对象
        self.arrow = None
        self.update()
    
    def get_rectangle_center(self, rect):
        """获取矩形的中心点坐标"""
        x1, y1, x2, y2 = rect.get_pos()
        return ((x1 + x2) / 2, (y1 + y2) / 2)
    
    def get_rectangle_extended_bounds(self, rect):
        """获取矩形的扩展边界，用于区域划分"""
        x1, y1, x2, y2 = rect.get_pos()
        return x1, y1, x2, y2
    
    def determine_region(self, rect, point):
        """确定点相对于矩形的区域
        
        Args:
            rect: 矩形对象
            point: 点坐标 (x, y)
            
        Returns:
            str: 区域名称，可能值为：
                "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"
        """
        rx1, ry1, rx2, ry2 = self.get_rectangle_extended_bounds(rect)
        cx, cy = self.get_rectangle_center(rect)
        px, py = point
        
        # 确定垂直方向
        if py < ry1:
            vertical = "top"
        elif py > ry2:
            vertical = "bottom"
        elif py <= cy:
            vertical = "top"
        else:
            vertical = "bottom"
        
        # 确定水平方向
        if px < rx1:
            horizontal = "left"
        elif px > rx2:
            horizontal = "right"
        elif px <= cx:
            horizontal = "left"
        else:
            horizontal = "right"
        
        # 合并结果
        # 平衡判断水平和垂直方向的正区域，确保上下区域有足够的触发范围
        
        # 首先判断点是否在矩形的扩展边界外
        if py < ry1:  # 完全在矩形上方
            if px < rx1:  # 同时在矩形左方
                return "top-left"
            elif px > rx2:  # 同时在矩形右方
                return "top-right"
            else:  # 正上方
                return "top"
        elif py > ry2:  # 完全在矩形下方
            if px < rx1:  # 同时在矩形左方
                return "bottom-left"
            elif px > rx2:  # 同时在矩形右方
                return "bottom-right"
            else:  # 正下方
                return "bottom"
        elif px < rx1:  # 完全在矩形左方
            return "left"
        elif px > rx2:  # 完全在矩形右方
            return "right"
        
        # 否则点在矩形内部或边缘附近，根据距离比例判断区域
        # 计算点到矩形中心的距离
        dx = abs(px - cx)
        dy = abs(py - cy)
        
        # 根据距离比例判断是水平还是垂直方向占主导
        if dx > dy * 1.5:  # 水平方向占主导
            # 左区域：x < cx
            if px < cx:
                return "left"
            # 右区域：x > cx
            else:
                return "right"
        elif dy > dx * 1.5:  # 垂直方向占主导
            # 上区域：y < cy
            if py < cy:
                return "top"
            # 下区域：y > cy
            else:
                return "bottom"
        elif dy > dx:  # 垂直方向略占主导
            # 上区域：y < cy
            if py < cy:
                return "top"
            # 下区域：y > cy
            else:
                return "bottom"
        else:  # 水平方向略占主导
            # 左区域：x < cx
            if px < cx:
                return "left"
            # 右区域：x > cx
            else:
                return "right"
    
    def calculate_shortest_points(self):
        """根据区域划分确定箭头的连线方式
        
        Returns:
            tuple: (from_point, to_point)，根据区域规则确定的点对类型
        """
        # 获取矩形1的中心点
        rect1_center = self.get_rectangle_center(self.rect1)
        
        # 确定矩形1中心点相对于矩形2的区域
        region = self.determine_region(self.rect2, rect1_center)
        
        # 更新区域历史记录
        self.update_region_history(self.rect1, self.rect2, region)
        
        # 获取历史区域
        prev_region, curr_region = self.get_region_history(self.rect1, self.rect2)
        
        # 根据区域规则确定连线方式
        # 对于正区域（上、下、左、右）
        if region == "top":
            # 矩形1在矩形2的上方，所以从矩形1的下边连向矩形2的上边
            return "bottom", "top"
        elif region == "bottom":
            # 矩形1在矩形2的下方，所以从矩形1的上边连向矩形2的下边
            return "top", "bottom"
        elif region == "left":
            # 矩形1在矩形2的左方，所以从矩形1的右边连向矩形2的左边
            return "right", "left"
        elif region == "right":
            # 矩形1在矩形2的右方，所以从矩形1的左边连向矩形2的右边
            return "left", "right"
        # 对于斜区域（左上、右上、左下、右下），使用历史记录
        elif region == "top-left":
            # 矩形1在矩形2的左上方，根据上次区域决定
            # 优先考虑从左右区域移动过来的情况
            if prev_region in ["left", "bottom-left", "right", "bottom-right"]:
                # 从左边或右边移动过来，保持水平方向连接
                if prev_region in ["left", "bottom-left"]:
                    return "right", "left"
                else:
                    return "left", "right"
            elif prev_region in ["top", "top-right"]:
                # 从上边或右上移动过来，保持从上边连接
                return "bottom", "top"
            else:
                # 默认情况，优先使用水平方向连接
                return "right", "left"
        elif region == "top-right":
            # 矩形1在矩形2的右上方
            # 优先考虑从左右区域移动过来的情况
            if prev_region in ["left", "bottom-left", "right", "bottom-right"]:
                # 从左边或右边移动过来，保持水平方向连接
                if prev_region in ["left", "bottom-left"]:
                    return "right", "left"
                else:
                    return "left", "right"
            elif prev_region in ["top", "top-left"]:
                # 从上边或左上移动过来，保持从上边连接
                return "bottom", "top"
            else:
                # 默认情况，优先使用水平方向连接
                return "left", "right"
        elif region == "bottom-left":
            # 矩形1在矩形2的左下方
            # 优先考虑从左右区域移动过来的情况
            if prev_region in ["left", "top-left", "right", "top-right"]:
                # 从左边或右边移动过来，保持水平方向连接
                if prev_region in ["left", "top-left"]:
                    return "right", "left"
                else:
                    return "left", "right"
            elif prev_region in ["bottom", "bottom-right"]:
                # 从下边或右下移动过来，保持从下边连接
                return "top", "bottom"
            else:
                # 默认情况，优先使用水平方向连接
                return "right", "left"
        elif region == "bottom-right":
            # 矩形1在矩形2的右下方
            # 优先考虑从左右区域移动过来的情况
            if prev_region in ["left", "top-left", "right", "top-right"]:
                # 从左边或右边移动过来，保持水平方向连接
                if prev_region in ["left", "top-left"]:
                    return "right", "left"
                else:
                    return "left", "right"
            elif prev_region in ["bottom", "bottom-left"]:
                # 从下边或左下移动过来，保持从下边连接
                return "top", "bottom"
            else:
                # 默认情况，优先使用水平方向连接
                return "left", "right"
        
        # 默认情况，返回中心点连接
        return "center", "center"
    
    def get_point_coords(self, rect, point_type):
        """获取矩形指定点的坐标
        
        Args:
            rect: 矩形对象
            point_type: 点类型 (center, top, bottom, left, right)
            
        Returns:
            tuple: (x, y) 坐标
        """
        if point_type == "center":
            return rect.get_center()
        else:
            return rect.get_edge_center(point_type)
    
    def update(self):
        """更新箭头位置和方向"""
        # 如果是自动模式，重新计算最短路径
        if self.auto_mode:
            self.from_point, self.to_point = self.calculate_shortest_points()
        
        # 获取起始点和目标点坐标
        x1, y1 = self.get_point_coords(self.rect1, self.from_point)
        x2, y2 = self.get_point_coords(self.rect2, self.to_point)
        
        # 删除旧箭头
        if self.arrow:
            self.canvas.delete(self.arrow)
        
        # 绘制新箭头
        self.arrow = self.canvas.create_line(x1, y1, x2, y2, 
                                            fill=self.color, 
                                            width=self.width, 
                                            arrow=tk.LAST, 
                                            arrowshape=(self.arrow_size, self.arrow_size, self.arrow_size//2))
    
    def set_shortest_path(self):
        """设置箭头为最短路径"""
        self.from_point, self.to_point = self.calculate_shortest_points()
        self.auto_mode = True
        self.update()
    
    def set_from_point(self, point_type):
        """设置起始点类型
        
        Args:
            point_type: 点类型 (center, top, bottom, left, right)
        """
        if point_type in ["center", "top", "bottom", "left", "right"]:
            self.from_point = point_type
            self.auto_mode = False  # 切换到手动模式
            self.update()
    
    def set_to_point(self, point_type):
        """设置目标点类型
        
        Args:
            point_type: 点类型 (center, top, bottom, left, right)
        """
        if point_type in ["center", "top", "bottom", "left", "right"]:
            self.to_point = point_type
            self.auto_mode = False  # 切换到手动模式
            self.update()