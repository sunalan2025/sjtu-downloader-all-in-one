package me.hisunalan.sjtudownloader;

final class SchedulePresentation {
    static String title(TodayScheduleWidget.Item item){
        if(!"exam".equals(item.category)||item.assignment)return item.title;
        String name=item.courseName.trim().isEmpty()?item.title:item.courseName.trim();
        return name.endsWith("考试")?name:name+"考试";
    }
    static String caption(TodayScheduleWidget.Item item,long now){
        return title(item)+"\n"+TodayScheduleWidget.format(item.start,"HH:mm")+"–"+TodayScheduleWidget.format(item.end,"HH:mm")+
            (item.place.isEmpty()?"":"\n"+item.place);
    }
}
