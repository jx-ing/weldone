import React from 'react';

export default function WeldPoseHelp() {
 return <details className="weld-pose-help">
  <summary>焊枪姿态角定义</summary>
  <dl>
   <dt>工作角</dt><dd>前进角为 0° 时，工作角 0° 沿接头横向。正值使焊丝轴向板面参考法向抬起。</dd>
   <dt>前进角</dt><dd>0° 时焊丝轴位于焊缝横截面。正值使焊丝轴朝当前焊接方向倾斜，反向焊接时随行走方向反转。</dd>
   <dt>旋转角</dt><dd>0° 时 TCP X 沿行走方向在焊丝轴垂面上的投影。正值按右手定则绕 TCP Z 转动。TCP Z 从焊丝尖端指向枪体。</dd>
  </dl>
 </details>;
}
