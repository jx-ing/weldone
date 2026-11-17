# 点云逆向建模

## 重磅板

[heavy_plate.py](heavy_plate.py) 用主平面作为底板基准，在该平面附近求底板外轮廓，并用侧壁最深一批采样估算板厚。对可识别的圆角矩形底板，依据侧壁拟合边线和斜度，用圆弧拟合圆角及缺口，再以两截面生成平滑的 CAD 实体。其他底板外形采用采样轮廓近似。高出底板的点按平面投影的连通区域分组。每组生成一个独立重磅板。具备同心内外边界的区域拟合为圆环，根据侧壁采样计算锥度。其他区域由截面轮廓及可辨认的孔拉伸成实体。装配中恰有一件底板，重磅板数量随可区分的连通区域变化。相接或存在遮挡的重磅板需要足够的分界采样。

## 小组立

[subassembly.py](subassembly.py) 校验法向与空间坐标的对应关系，再按成对平行且方向相反的板面分离零件，估计板厚、投影轮廓和可见孔。对已核对尺寸、底板厚度和 12 个肋板站位的台阶式底板结构，[stepped_deck.py](stepped_deck.py) 用拟合的圆弧、缺口、孔和套筒表达已识别特征，肋板、斜板和加强件轮廓从当前点云重建。其他结构走成对板面的通用路径，覆盖可辨认的独立平面板件。通用路径需要可配对的双面采样，对未见过构型中的曲面构件或遮挡边界仍需补充识别与验证。

## 软件接口

- 在工艺规划导入点云后，点击 **逆向建模**。完成后可下载 STEP 或直接载入模型视图。坐标按毫米处理并保留原点云坐标系。
- 浏览器支持 TXT、XYZ、PLY、PCD。小组立需要 PLY 或 PCD 中有效的顶点法向。旧版本已缓存的点云若缺少法向，可重新导入原文件。
- 后续工件类型控件可设置工作区的 `workpieceType` 为 `重磅板` 或 `小组立`。本机调用使用 `POST /api/reverse-model?workpieceType=heavy-plate` 或 `subassembly`。缺省使用 `auto`，按法向是否存在和点云长宽特征初选。
- 请求体是 32 字节小端头（3 个 float64 原点、uint32 点数、uint32 法向标记）、紧接点坐标和可选法向的 float32 XYZ 数组。响应是 STEP 装配文件，`Server-Timing` 给出预处理、重建、导出并校验的阶段耗时。
- 几何内核是 Open CASCADE。写入后用同一内核重新导入，校验装配层级、闭合实体及体积。运行依赖 Python、NumPy、SciPy、Shapely 和 OCP，可通过 `WELDONE_REVERSE_PYTHON` 指定 Python。

命令行也可独立运行。输入支持 TXT、XYZ 或 PLY。

```powershell
python scripts/reverse-model/reconstruct.py input.txt output.step --type heavy-plate
python scripts/reverse-model/reconstruct.py input.ply output.step --type subassembly
```
