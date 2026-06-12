/**
 * MindSpace - Healing Quotes database
 * Provides warm, empathetic, and time-aware psychological suggestions.
 */
const MindSpaceQuotes = {
    morning: [
        { text: "早安。新的一天，太阳照常升起。先深呼吸一次，对自己温柔一点吧。", author: "心空暖阳" },
        { text: "清晨的微风很温柔。今天不需要做一个完美的人，只做一个轻松的人就好。", author: "清风细语" },
        { text: "新的一天开始了。给昨天的故事画个句号，此刻的你，是全新且自由的。", author: "晨曦树洞" },
        { text: "早安！如果感觉疲惫，别强求自己。今天，一小步的挪动也是了不起的胜利。", author: "正念时刻" }
    ],
    afternoon: [
        { text: "下午好。忙碌的空隙里，别忘了动动肩膀，喝杯温水，给紧绷的神经放个小假。", author: "暖心树洞" },
        { text: "如果手头的事情让你感到焦虑，试着闭眼深呼吸三次，把焦点带回脚踩在大地上的感觉。", author: "身体扫描" },
        { text: "午后的阳光很温暖，接纳此时此刻哪怕效率低落的自己，休息并不是浪费时间。", author: "心空庇护所" },
        { text: "每一片叶子的飘落都有它的节奏。别急，允许自己以舒服的步调慢慢来。", author: "时间的朋友" }
    ],
    night: [
        { text: "夜深了。把今天的所有繁恼都卸下留在今天吧，你已经尽力做得很好了，辛苦啦。", author: "月光树屋" },
        { text: "世界已经安静下来，你的心也可以靠岸了。闭上眼睛，今晚只负责好梦。", author: "安神岛屿" },
        { text: "雷雨终会过去，黑夜也终会迎来晨光。抱抱紧绷了一天的自己，晚安。", author: "温暖港湾" },
        { text: "把头放在柔软的枕头上，放空思绪。今夜，心空会为你遮风挡雨。", author: "星空低语" }
    ],
    general: [
        { text: "情绪像天空的云朵，飘来又飘走。你不是那些情绪，你只是观察云朵的天空。", author: "正念导师" },
        { text: "难过、沮丧、疲惫都是生命的自然天气。接纳下雨的自己，也是一种极大的勇气。", author: "内心气象台" },
        { text: "你不需要为自己有负面情绪而感到内疚，允许它们存在，它们只是在提醒你需要关爱自己了。", author: "温暖拥抱" },
        { text: "我们总是对他人宽容，却对自己苛刻。试着用对待最好朋友的方式，对待你自己。", author: "自我关怀" },
        { text: "慢慢来，最慢的步伐也是在向前走。每一粒种子，都有它破土而出的合适季节。", author: "心空树洞" }
    ],

    /**
     * Get a random healing quote based on the current system time
     */
    getRandomQuote() {
        const hour = new Date().getHours();
        let pool = [];

        if (hour >= 5 && hour < 12) {
            // Morning
            pool = [...this.morning, ...this.general];
        } else if (hour >= 12 && hour < 18) {
            // Afternoon
            pool = [...this.afternoon, ...this.general];
        } else {
            // Night
            pool = [...this.night, ...this.general];
        }

        const randomIndex = Math.floor(Math.random() * pool.length);
        return pool[randomIndex];
    }
};
