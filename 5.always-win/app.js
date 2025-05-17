// 剪刀石头布的姿势定义
const GesturePresets = {
    ROCK: {
        finger: [49, 32, 40, 36, 41, 46],
        palm: [255, 235, 128, 128]
    },
    PAPER: {
        finger: [255, 255, 255, 255, 255, 255],
        palm: [128, 128, 128, 128]
    },
    SCISSORS: {
        finger: [0, 103, 255, 255, 0, 0],
        palm: [255, 235, 128, 128]
    }
};

// 网络请求抽象
async function sendPose(endpoint, pose) {
    try {
        const response = await fetch(`http://localhost:9099${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pose })
        });

        const data = await response.json();
        if (data.status === 'success') {
            console.log(`${endpoint} 发送成功`, pose);
        } else {
            console.error(`${endpoint} 发送失败`, data.error);
        }
    } catch (error) {
        console.error(`${endpoint} 请求错误`, error);
    }
}


// 封装调用函数
async function performGesture(gesture) {
    const preset = GesturePresets[gesture];

    if (!preset) {
        console.error('无效的手势:', gesture);
        return;
    }

    // 发送掌部姿势
    await sendPose('/api/palm', preset.palm);

    // 稍微延迟后发送手指姿势
    setTimeout(async () => {
        await sendPose('/api/fingers', preset.finger);
    }, 30);
}

// 处理手势变化，使用防抖动技术确保手势稳定
function handleGestureChange(newGesture, confidence) {
    // 只有在手势变化且置信度足够高时才处理
    if (newGesture !== lastDetectedGesture && newGesture !== "未识别" && confidence >= 0.7) {
        // 清除任何现有的定时器
        if (gestureChangeTimeout) {
            clearTimeout(gestureChangeTimeout);
        }
        
        // 设置新的定时器 - 手势必须保持稳定500毫秒才会触发事件
        gestureChangeTimeout = setTimeout(() => {
            // 更新最后检测到的手势
            lastDetectedGesture = newGesture;

            // 播放音效 (可选)
            playGestureSound(newGesture);
            
        }, 100); // 500毫秒的防抖动延迟
    }
    
    // 如果手势变为"未识别"，重置最后检测到的手势
    if (newGesture === "未识别") {
        lastDetectedGesture = "";
        if (gestureChangeTimeout) {
            clearTimeout(gestureChangeTimeout);
            gestureChangeTimeout = null;
        }
    }
}

// 播放手势音效 (可选功能)
function playGestureSound(gesture) {
    // 这里可以根据不同手势播放不同的音效
    // 简单的音效实现
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    
    // 根据手势设置不同的音调
    switch(gesture) {
        case "石头":
            oscillator.frequency.value = 261.63; // C4
            break;
        case "剪刀":
            oscillator.frequency.value = 329.63; // E4
            break;
        case "布":
            oscillator.frequency.value = 392.00; // G4
            break;
    }
    
    // 短暂的音效
    gainNode.gain.value = 0.1;
    oscillator.start();
    
    setTimeout(() => {
        oscillator.stop();
    }, 200);
}// 页面元素
const video = document.getElementById('webcam');
const canvas = document.getElementById('output-canvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('start-btn');
const stopButton = document.getElementById('stop-btn');
const handCountSpan = document.getElementById('hand-count');
const landmarksInfo = document.getElementById('landmarks-info');
const fpsCounter = document.getElementById('fps');
const gestureDisplay = document.getElementById('gesture-display');
const eventLogDiv = document.getElementById('event-log');
const clearLogButton = document.getElementById('clear-log-btn');

// 手势置信度元素
const rockConfidence = document.getElementById('rock-confidence');
const paperConfidence = document.getElementById('paper-confidence');
const scissorsConfidence = document.getElementById('scissors-confidence');

// 手势卡片元素
const rockCard = document.getElementById('rock-card');
const paperCard = document.getElementById('paper-card');
const scissorsCard = document.getElementById('scissors-card');

// 全局变量
let hands;
let camera;
let lastFrameTime = 0;
let isRunning = false;
let currentGesture = "未识别";
let gestureConfidence = 0;
let lastDetectedGesture = ""; // 用于记录上一次检测到的手势
let gestureChangeTimeout = null; // 用于防抖动的超时变量

// 定义手部连接关系 (MediaPipe Hands模型的21个关键点连接方式)
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],  // 拇指
    [0, 5], [5, 6], [6, 7], [7, 8],  // 食指
    [0, 9], [9, 10], [10, 11], [11, 12],  // 中指
    [0, 13], [13, 14], [14, 15], [15, 16],  // 无名指
    [0, 17], [17, 18], [18, 19], [19, 20],  // 小指
    [5, 9], [9, 13], [13, 17],  // 掌心连接
    [0, 5], [0, 17]  // 手腕连接
];

// 设置canvas大小
function setupCanvas() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}

// 初始化MediaPipe Hands模型
async function initHandDetection() {
    try {
        statusDiv.textContent = "正在加载手部检测模型...";
        
        hands = new Hands({
            locateFile: (file) => {
                return `libs/mediapipe/hands/${file}`;
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        // 配置模型
        await hands.setOptions({
            maxNumHands: 2,              // 最多检测2只手
            modelComplexity: 1,          // 模型复杂度 (0, 1)
            minDetectionConfidence: 0.5, // 最小检测置信度
            minTrackingConfidence: 0.5   // 最小跟踪置信度
        });

        // 设置结果回调
        hands.onResults(onResults);

        statusDiv.textContent = "模型加载完成，点击'启动摄像头'开始检测";
        startButton.disabled = false;

    } catch (error) {
        statusDiv.textContent = `初始化失败: ${error.message}`;
        console.error("初始化失败:", error);
    }
}

// 处理检测结果
function onResults(results) {
    // 计算FPS
    const now = performance.now();
    const elapsed = now - lastFrameTime;
    lastFrameTime = now;
    const fps = Math.round(1000 / elapsed);
    fpsCounter.textContent = `FPS: ${fps}`;

    // 清除canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 更新检测到的手数量
    const handCount = results.multiHandLandmarks?.length || 0;
    handCountSpan.textContent = handCount;

    // 重置手势置信度显示
    resetGestureConfidence();

    // 如果检测到手
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // 绘制手部关键点
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i].label; // 'Left' 或 'Right'
            
            // 绘制连接线和关键点
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, 
                { color: handedness === 'Left' ? '#00FF00' : '#FF0000', lineWidth: 5 });
            drawLandmarks(ctx, landmarks, 
                { color: handedness === 'Left' ? '#00CC00' : '#CC0000', lineWidth: 2 });
            
            // 在手腕处标示左/右手
            const wrist = landmarks[0];
            ctx.fillStyle = handedness === 'Left' ? '#00FF00' : '#FF0000';
            ctx.font = '16px Arial';
            ctx.fillText(handedness === 'Left' ? '左手' : '右手', 
                         wrist.x * canvas.width, 
                         wrist.y * canvas.height - 10);
            
            // 识别石头剪刀布手势
            const gesture = recognizeRockPaperScissors(landmarks);
            
            // 在手部上方显示识别的手势
            ctx.font = '20px Arial';
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            const gestureText = `${gesture.name} (${Math.round(gesture.confidence * 100)}%)`;
            const textX = wrist.x * canvas.width;
            const textY = wrist.y * canvas.height - 30;
            ctx.strokeText(gestureText, textX, textY);
            ctx.fillText(gestureText, textX, textY);
            
            // 更新手势置信度显示
            updateGestureConfidence(gesture.name, gesture.confidence);
            
            // 如果置信度高，更新当前识别的手势
            if (gesture.confidence > 0.7 && gesture.name !== "未识别") {
                currentGesture = gesture.name;
                gestureConfidence = gesture.confidence;
            }
        }

        // 更新关键点信息
        updateLandmarksInfo(results.multiHandLandmarks, results.multiHandedness);
    } else {
        landmarksInfo.textContent = "尚未检测到手部";
        currentGesture = "等待手势...";
        gestureConfidence = 0;
    }
    
    // 更新屏幕上的手势显示
    updateGestureDisplay();
}

// 识别石头剪刀布手势
function recognizeRockPaperScissors(landmarks) {
    // 计算每个手指的伸展状态
    const thumbIsOpen = isThumbOpen(landmarks);
    const indexIsOpen = isFingerOpen(landmarks, 8, 6);
    const middleIsOpen = isFingerOpen(landmarks, 12, 10);
    const ringIsOpen = isFingerOpen(landmarks, 16, 14);
    const pinkyIsOpen = isFingerOpen(landmarks, 20, 18);
    
    // 获取手指打开状态
    const openFingers = [thumbIsOpen, indexIsOpen, middleIsOpen, ringIsOpen, pinkyIsOpen];
    const openCount = openFingers.filter(Boolean).length;
    
    // 识别手势逻辑
    let gesture = "未识别";
    let confidence = 0.5; // 默认置信度
    
    // 石头: 所有手指都弯曲
    if (!thumbIsOpen && !indexIsOpen && !middleIsOpen && !ringIsOpen && !pinkyIsOpen) {
        gesture = "石头";
        confidence = 0.9;
    }
    // 布: 所有手指都伸展
    else if (openCount >= 4) {
        gesture = "布";
        confidence = 0.85;
    }
    // 剪刀: 食指和中指伸展，其他手指弯曲
    else if (indexIsOpen && middleIsOpen && !ringIsOpen && !pinkyIsOpen) {
        gesture = "剪刀";
        confidence = 0.8;
    }
    
    return { name: gesture, confidence: confidence };
}

// 检查拇指是否伸展
function isThumbOpen(landmarks) {
    const thumb_tip = landmarks[4];
    const thumb_ip = landmarks[3];
    
    // 拇指特殊处理，检查拇指尖与手指关节的位置关系
    return thumb_tip.x < thumb_ip.x; 
}

// 检查手指是否伸展 (通过比较指尖和手指关节的y坐标)
function isFingerOpen(landmarks, tipIdx, pipIdx) {
    const finger_tip = landmarks[tipIdx];
    const finger_pip = landmarks[pipIdx];
    
    // 指尖应该高于手指关节（y坐标更小）
    return finger_tip.y < finger_pip.y;
}


    
var gestureCaches = {};
var bounceHandler = null;

// 更新手势置信度显示
function updateGestureConfidence(gesture, confidence) {
    const confidencePercent = Math.round(confidence * 100);
    
    // 根据识别的手势更新对应的置信度
    switch(gesture) {
        case "石头":
            rockConfidence.textContent = `${confidencePercent}%`;
            rockCard.classList.add('active');
            break;
        case "布":
            paperConfidence.textContent = `${confidencePercent}%`;
            paperCard.classList.add('active');
            break;
        case "剪刀":
            scissorsConfidence.textContent = `${confidencePercent}%`;
            scissorsCard.classList.add('active');
            break;
        default:
            // 未识别，不更新
            break;
    }

    bounceHandler = setTimeout(() => {
        clearInterval(bounceHandler);

        if (confidencePercent > 70) {
            switch(gesture) {
                case "石头":
                    performGesture('PAPER');   // 出布
                    break;
                case "布":
                    performGesture('SCISSORS'); // 出剪刀
                    break;
                case "剪刀":
                    performGesture('ROCK');    // 出拳
                    break;
                default:
                    // 未识别，不更新
                    break;
            }
        }
    
    },30)


}

// 重置手势置信度显示
function resetGestureConfidence() {
    rockConfidence.textContent = "0%";
    paperConfidence.textContent = "0%";
    scissorsConfidence.textContent = "0%";
    
    rockCard.classList.remove('active');
    paperCard.classList.remove('active');
    scissorsCard.classList.remove('active');
}

// 更新手势显示
function updateGestureDisplay() {
    let icon = "";
    
    // 根据手势设置图标
    switch(currentGesture) {
        case "石头":
            icon = "👊";
            break;
        case "布":
            icon = "✋";
            break;
        case "剪刀":
            icon = "✌️";
            break;
        default:
            icon = "";
            break;
    }
    
    // 更新显示
    if (currentGesture !== "等待手势...") {
        const confidencePercent = Math.round(gestureConfidence * 100);
        gestureDisplay.textContent = `${icon} ${currentGesture} ${confidencePercent}%`;
    } else {
        gestureDisplay.textContent = currentGesture;
    }
}

// 更新关键点信息显示
function updateLandmarksInfo(multiHandLandmarks, multiHandedness) {
    let infoText = '';
    
    for (let i = 0; i < multiHandLandmarks.length; i++) {
        const handedness = multiHandedness[i].label;
        const confidence = multiHandedness[i].score.toFixed(2);
        const landmarks = multiHandLandmarks[i];
        
        // 识别手势
        const gesture = recognizeRockPaperScissors(landmarks);
        
        infoText += `手 #${i+1} (${handedness === 'Left' ? '左手' : '右手'}, 置信度: ${confidence})\n`;
        infoText += `检测到的手势: ${gesture.name} (置信度: ${gesture.confidence.toFixed(2)})\n`;
        
        // 处理手势变化
        handleGestureChange(gesture.name, gesture.confidence);
        
        // 计算指尖位置
        const fingertips = [
            { name: '拇指', index: 4 },
            { name: '食指', index: 8 },
            { name: '中指', index: 12 },
            { name: '无名指', index: 16 },
            { name: '小指', index: 20 }
        ];
        
        for (const finger of fingertips) {
            const tip = landmarks[finger.index];
            infoText += `  ${finger.name}尖: x=${Math.round(tip.x*100)/100}, y=${Math.round(tip.y*100)/100}, z=${Math.round(tip.z*100)/100}\n`;
        }
        
        infoText += '\n';
    }
    
    landmarksInfo.textContent = infoText || "尚未检测到手部";
}

// 启动摄像头
async function startCamera() {
    try {
        statusDiv.textContent = "正在启动摄像头...";
        
        const constraints = {
            video: {
                width: 640,
                height: 480
            }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            setupCanvas();
            startDetection();
        };
        
        startButton.disabled = true;
        stopButton.disabled = false;
        
    } catch (error) {
        statusDiv.textContent = `摄像头启动失败: ${error.message}`;
        console.error("摄像头启动失败:", error);
    }
}

// 开始检测
function startDetection() {
    if (isRunning) return;
    
    isRunning = true;
    statusDiv.textContent = "正在检测手部...";
    
    // 初始化相机辅助工具
    camera = new Camera(video, {
        onFrame: async () => {
            await hands.send({image: video});
        },
        width: 640,
        height: 480
    });
    
    camera.start();
}

// 停止检测
function stopDetection() {
    if (!isRunning) return;
    
    isRunning = false;
    
    if (camera) {
        camera.stop();
    }
    
    if (video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    handCountSpan.textContent = "0";
    landmarksInfo.textContent = "尚未检测到手部";
    statusDiv.textContent = "检测已停止";
    gestureDisplay.textContent = "等待手势...";
    resetGestureConfidence();
    
    startButton.disabled = false;
    stopButton.disabled = true;
}

// 辅助函数 - 绘制关键点连接线
function drawConnectors(ctx, landmarks, connections, options) {
    const { color = 'white', lineWidth = 1 } = options || {};
    
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    
    for (const connection of connections) {
        const [i, j] = connection;
        const from = landmarks[i];
        const to = landmarks[j];
        
        if (from && to) {
            ctx.beginPath();
            ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
            ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
            ctx.stroke();
        }
    }
}

// 辅助函数 - 绘制关键点
function drawLandmarks(ctx, landmarks, options) {
    const { color = 'red', lineWidth = 2 } = options || {};
    
    ctx.fillStyle = color;
    
    for (const landmark of landmarks) {
        ctx.beginPath();
        ctx.arc(
            landmark.x * canvas.width,
            landmark.y * canvas.height,
            lineWidth * 2,
            0,
            2 * Math.PI
        );
        ctx.fill();
    }
}

// 设置事件监听器
startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopDetection);

// 页面加载完成后初始化
window.addEventListener('load', () => {
    initHandDetection();
    
    // 添加手势事件监听器
    document.addEventListener('gestureDetected', (event) => {
        const gestureData = event.detail;
        
        // 在页面中显示事件信息
        const messageContainer = document.createElement('div');
        messageContainer.className = 'gesture-message';
        messageContainer.innerHTML = `
            <div class="gesture-message-content">
                <strong>检测到手势:</strong> ${gestureData.gesture} 
                <span class="gesture-message-confidence">置信度: ${Math.round(gestureData.confidence * 100)}%</span>
                <span class="gesture-message-time">${new Date().toLocaleTimeString()}</span>
            </div>
        `;
        
        // 添加到页面
        document.body.appendChild(messageContainer);
        
        // 设置动画
        setTimeout(() => {
            messageContainer.classList.add('show');
        }, 10);
        
        // 2秒后移除消息
        setTimeout(() => {
            messageContainer.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(messageContainer);
            }, 500);
        }, 2000);
    });
});
