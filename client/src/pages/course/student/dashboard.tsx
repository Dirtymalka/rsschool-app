import { message, Result } from 'antd';
import moment from 'moment';
import Masonry from 'react-masonry-css';
import css from 'styled-jsx/css';
import { useAsync } from 'react-use';
import { useMemo, useState } from 'react';

import { PageLayout, LoadingScreen } from 'components';
import withCourseData from 'components/withCourseData';
import withSession from 'components/withSession';
import { CourseService, StudentSummary, CourseTask, CourseEvent } from 'services/course';
import { CoursePageProps } from 'services/models';
import { UserService } from 'services/user';
import { StudentTasksDetail } from '../../../../../common/models';
import { MainStatsCard, MentorCard, TasksStatsCard, NextEventCard, RepositoryCard } from 'components/Dashboard';

function Page(props: CoursePageProps) {
  const { githubId } = props.session;
  const { fullName } = props.course;

  const courseService = useMemo(() => new CourseService(props.course.id), [props.course.id]);
  const userService = useMemo(() => new UserService(), [props.course.id]);

  const [studentSummary, setStudentSummary] = useState({} as StudentSummary);
  const [courseTasks, setCourseTasks] = useState<CourseTask[]>([]);
  const [tasksDetail, setTasksDetail] = useState<StudentTasksDetail[]>([]);
  const [nextEvents, setNextEvent] = useState([] as CourseEvent[]);
  const [countEvents, setCountEvents] = useState(showCountEventsOnStudentsDashboard());
  const [loading, setLoading] = useState(false);

  const changeCountEvents = (value: number) => {
    localStorage.setItem('showCountEventsOnStudentsDashboard', String(value));
    setCountEvents(value);
  };

  useAsync(async () => {
    try {
      setLoading(true);

      const [studentSummary, courseTasks, statisticsCourses, courseEvents] = await Promise.all([
        courseService.getStudentSummary(githubId),
        courseService.getCourseTasks(),
        userService.getProfileInfo(githubId),
        courseService.getCourseEvents(),
      ]);
      const tasksDetailCurrentCourse =
        statisticsCourses.studentStats?.find(course => course.courseId === props.course.id)?.tasks ?? [];
      const startOfToday = moment().startOf('day');
      const nextEvents =
        courseEvents
          .concat(tasksToEvents(courseTasks))
          .sort((a, b) => a.dateTime.localeCompare(b.dateTime))
          .filter(event => moment(event.dateTime).isAfter(startOfToday)) ?? ([] as CourseEvent[]);

      setNextEvent(nextEvents);
      setStudentSummary(studentSummary);
      setCourseTasks(courseTasks);
      setTasksDetail(tasksDetailCurrentCourse);
    } catch {
      message.error('An error occurred. Please try later.');
    } finally {
      setLoading(false);
    }
  }, [props.course.id]);

  const currentDate = moment().format('YYYY MM DD');

  const studentPosition = studentSummary?.rank ?? 0;

  const maxCourseScore = Math.round(
    courseTasks.reduce((score, task) => score + (task.maxScore ?? 0) * task.scoreWeight, 0),
  );

  const tasksCompleted = courseTasks
    .filter(task => !!checkTaskResults(studentSummary.results, task.id))
    .map(task => {
      const { comment, taskGithubPrUris, score } = tasksDetail.find(taskDetail => taskDetail.name === task.name) ?? {};
      return { ...task, comment, githubPrUri: taskGithubPrUris, score };
    });
  const tasksNotDone = courseTasks
    .filter(
      task =>
        moment(task.studentEndDate as string).isBefore(currentDate, 'date') &&
        !checkTaskResults(studentSummary.results, task.id),
    )
    .map(task => ({ ...task, comment: null, githubPrUri: null, score: 0 }));
  const tasksFuture = courseTasks
    .filter(
      task =>
        moment(task.studentEndDate as string).isAfter(currentDate, 'date') &&
        !checkTaskResults(studentSummary.results, task.id),
    )
    .map(task => ({ ...task, comment: null, githubPrUri: null, score: null }));

  const taskStatistics = { completed: tasksCompleted, notDone: tasksNotDone, future: tasksFuture };
  const { isActive, totalScore } = studentSummary ?? {};

  const cards = [
    studentSummary && (
      <MainStatsCard
        isActive={isActive}
        totalScore={totalScore}
        position={studentPosition}
        maxCourseScore={maxCourseScore}
      />
    ),
    <RepositoryCard
      githubId={githubId}
      url={studentSummary?.repository}
      onSendInviteRepository={courseService.sendInviteRepository.bind(courseService)}
    />,
    studentSummary?.mentor && <MentorCard mentor={studentSummary?.mentor} />,
    courseTasks.length && <TasksStatsCard tasks={taskStatistics} courseName={fullName} />,
    <NextEventCard nextEvents={nextEvents} showCountEvents={countEvents} setShowCountEvents={changeCountEvents} />,
  ].filter(Boolean) as JSX.Element[];

  return (
    <PageLayout
      loading={loading}
      title="Student dashboard"
      githubId={props.session.githubId}
      courseName={props.course.name}
    >
      <LoadingScreen show={loading}>
        {studentSummary ? (
          <div style={{ padding: 10 }}>
            <Masonry
              breakpointCols={{
                default: 4,
                1100: 3,
                700: 2,
                500: 1,
              }}
              className={masonryClassName}
              columnClassName={masonryColumnClassName}
            >
              {cards.map((card, idx) => (
                <div style={{ marginBottom: gapSize }} key={`card-${idx}`}>
                  {card}
                </div>
              ))}
            </Masonry>
            {masonryStyles}
            {masonryColumnStyles}
          </div>
        ) : (
          <>
            <Result status={'403' as any} title="No access or user does not exist" />
          </>
        )}
      </LoadingScreen>
    </PageLayout>
  );
}

const gapSize = 16;
const { className: masonryClassName, styles: masonryStyles } = css.resolve`
  div {
    display: flex;
    margin-left: -${gapSize}px;
    width: auto;
  }
`;
const { className: masonryColumnClassName, styles: masonryColumnStyles } = css.resolve`
  div {
    padding-left: ${gapSize}px;
    background-clip: padding-box;
  }
`;

const TaskTypes = {
  deadline: 'deadline',
  test: 'test',
  newtask: 'newtask',
  lecture: 'lecture',
};

const checkTaskResults = (results: any[], taskId: number) => results.find((task: any) => task.courseTaskId === taskId);

const tasksToEvents = (tasks: CourseTask[]) => {
  return tasks.reduce((acc: Array<CourseEvent>, task: CourseTask) => {
    if (task.type !== TaskTypes.test) {
      acc.push(createCourseEventFromTask(task, task.type));
    }
    acc.push(createCourseEventFromTask(task, task.type === TaskTypes.test ? TaskTypes.test : TaskTypes.deadline));
    return acc;
  }, []);
};

const createCourseEventFromTask = (task: CourseTask, type: string): CourseEvent => {
  return {
    id: task.id,
    dateTime: (type === TaskTypes.deadline ? task.studentEndDate : task.studentStartDate) || '',
    event: {
      type: type,
      name: task.name,
      descriptionUrl: task.descriptionUrl,
    },
  } as CourseEvent;
};

const showCountEventsOnStudentsDashboard = () =>
  Number(
    localStorage.getItem('showCountEventsOnStudentsDashboard')
      ? localStorage.getItem('showCountEventsOnStudentsDashboard')
      : 1,
  );

export default withCourseData(withSession(Page));
