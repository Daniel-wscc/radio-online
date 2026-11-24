/* YouTube 播放佇列的上移、下移與隨機排序。拖曳在電視遙控器上不好用，所以改成按鈕。 */
(function (root) {
    'use strict';

    function moveItem(list, from, to, currentIndex) {
        var next = list.slice();
        if (from < 0 || to < 0 || from >= next.length || to >= next.length || from === to) {
            return { list: next, currentIndex: currentIndex };
        }
        var index = currentIndex;
        if (index === from) index = to;
        else if (index > from && index <= to) index--;
        else if (index < from && index >= to) index++;
        var item = next.splice(from, 1)[0];
        next.splice(to, 0, item);
        return { list: next, currentIndex: index };
    }

    function shuffleKeepCurrent(list, currentIndex, randomFn) {
        var next = list.slice();
        var currentId = currentIndex >= 0 && next[currentIndex] ? next[currentIndex].id : null;
        var random = randomFn || Math.random;
        var i;
        for (i = next.length - 1; i > 0; i--) {
            var j = Math.floor(random() * (i + 1));
            var tmp = next[i];
            next[i] = next[j];
            next[j] = tmp;
        }
        var index = currentIndex;
        if (currentId) {
            index = -1;
            for (i = 0; i < next.length; i++) {
                if (next[i].id === currentId) {
                    index = i;
                    break;
                }
            }
        }
        return { list: next, currentIndex: index };
    }

    root.PlaylistOrder = {
        moveItem: moveItem,
        shuffleKeepCurrent: shuffleKeepCurrent
    };
})(typeof window !== 'undefined' ? window : globalThis);
