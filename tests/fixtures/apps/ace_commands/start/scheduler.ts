import PodarNoticiasJob from '#jobs/podar_noticias_job'

// runs alone, at night: no transaction reaches it
PodarNoticiasJob.schedule({}).cron('0 3 * * *').run()

export {}
